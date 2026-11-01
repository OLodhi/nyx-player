//! Garde de la base SQLite : seule porte d'entrée du code web vers la base du compte.
//!
//! Les commandes du plugin SQL (`plugin:sql|load`, `execute`, `select`) laissaient le JavaScript
//! ouvrir une base à n'importe quel chemin (un chemin absolu remplace le dossier de l'app) et
//! exécuter n'importe quelle requête, dont `ATTACH DATABASE '<chemin>'` et `VACUUM INTO '<chemin>'`,
//! qui créent un fichier au contenu en partie choisi où l'utilisateur peut écrire (le dossier
//! Démarrage de Windows par exemple) : une faille XSS devenait une écriture de fichier sur le PC.
//! Ces commandes ne sont plus autorisées (`capabilities/default.json`) ; le web passe par :
//!
//! - `nyx_db_load` : n'ouvre que `nyxplayer_<uuid>.db`, dans le dossier de l'app ;
//! - `nyx_db_execute`, `nyx_db_select` : requêtes sur une base ouverte par `nyx_db_load` ;
//! - `nyx_db_close` : fermeture d'une base, ou de toutes.
//!
//! Chaque connexion refuse, dans le moteur SQLite lui-même (autorisateur et limite de bases
//! attachées, pas une recherche de mots qu'un commentaire contournerait) : `ATTACH`, `DETACH`,
//! `VACUUM` (qui attache sa base cible), `PRAGMA` (sauf la lecture de `data_version`, faite par
//! FTS5 lui-même), `load_extension`, et la création de déclencheurs et de vues. L'app n'en envoie
//! aucun depuis la page ; le code Rust (ingestion, guide, catalogue) garde ses propres connexions.
//!
//! Le reste reproduit à l'identique le plugin (tauri-plugin-sql 2.4.0, `wrapper.rs`) : même
//! dossier, mêmes réglages de connexion (base neuve créée en mode WAL, clés étrangères actives,
//! `busy_timeout` de 5 s, 10 connexions au plus), mêmes
//! conversions des valeurs dans les deux sens, mêmes messages d'erreur.

use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CStr};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use indexmap::IndexMap;
use rusqlite::ffi;
use serde_json::Value as JsonValue;
use sqlx::sqlite::{SqliteArguments, SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, Sqlite, TypeInfo, Value, ValueRef};
use tauri::{Manager, State};
use tokio::sync::RwLock;

use crate::storage::{finish_pending_reset, sanitize_error_path, validate_db_name};

/// Bases ouvertes par la page, par nom (`sqlite:nyxplayer_<uuid>.db`, comme le plugin).
#[derive(Default)]
pub struct NyxDatabases(RwLock<HashMap<String, SqlitePool>>);

/// Nom de fichier de la base demandée : `sqlite:` suivi de `nyxplayer_<uuid>.db`, rien d'autre
/// (ni chemin absolu, ni dossier, ni ancienne base `nyxplayer.db`).
fn database_file_name(db: &str) -> Result<&str, String> {
    let name = db
        .strip_prefix("sqlite:")
        .ok_or_else(|| format!("invalid connection url: {}", db))?;
    validate_db_name(name)?;
    Ok(name)
}

/// Autorisateur SQLite, consulté à la préparation de chaque requête.
unsafe extern "C" fn authorizer(
    _user_data: *mut c_void,
    action: c_int,
    arg1: *const c_char,
    arg2: *const c_char,
    _database: *const c_char,
    _trigger: *const c_char,
) -> c_int {
    match action {
        // FTS5 (index de recherche, `search_index`) lit lui-même `PRAGMA data_version` à chaque
        // ouverture de la table : seule lecture de réglage permise, sans valeur à écrire
        ffi::SQLITE_PRAGMA
            if arg2.is_null()
                && !arg1.is_null()
                && CStr::from_ptr(arg1).to_bytes().eq_ignore_ascii_case(b"data_version") =>
        {
            ffi::SQLITE_OK
        }
        ffi::SQLITE_ATTACH | ffi::SQLITE_DETACH | ffi::SQLITE_PRAGMA => ffi::SQLITE_DENY,
        // Déclencheurs et vues s'exécuteraient aussi dans les connexions Rust, non gardées
        // (ingestion, guide) : la page n'en crée jamais
        ffi::SQLITE_CREATE_TRIGGER
        | ffi::SQLITE_CREATE_TEMP_TRIGGER
        | ffi::SQLITE_CREATE_VIEW
        | ffi::SQLITE_CREATE_TEMP_VIEW => ffi::SQLITE_DENY,
        // Déjà désactivé par sqlx ; refusé ici aussi si un réglage venait à changer
        ffi::SQLITE_FUNCTION => {
            // Pour SQLITE_FUNCTION, arg2 est le nom de la fonction (arg1 est vide)
            let name = if arg2.is_null() { arg1 } else { arg2 };
            if !name.is_null() && CStr::from_ptr(name).to_bytes().eq_ignore_ascii_case(b"load_extension") {
                ffi::SQLITE_DENY
            } else {
                ffi::SQLITE_OK
            }
        }
        _ => ffi::SQLITE_OK,
    }
}

/// Pose la garde sur une connexion, avant toute requête de la page.
///
/// # Safety
/// `handle` doit être une connexion SQLite ouverte, non utilisée par un autre fil pendant l'appel.
unsafe fn install_guard(handle: *mut ffi::sqlite3) -> Result<(), String> {
    // Aucune base attachée : `ATTACH` et `VACUUM` (qui attache sa cible) échouent même si
    // l'autorisateur était contourné
    ffi::sqlite3_limit(handle, ffi::SQLITE_LIMIT_ATTACHED, 0);
    let rc = ffi::sqlite3_set_authorizer(handle, Some(authorizer), std::ptr::null_mut());
    if rc != ffi::SQLITE_OK {
        return Err(format!("SQLite authorizer not installed (code {})", rc));
    }
    Ok(())
}

/// Ouvre (et crée au besoin) la base au chemin donné, chaque connexion gardée.
/// Comme le plugin : une base absente est d'abord créée en mode WAL (`Sqlite::create_database`),
/// puis ouverte avec les `SqliteConnectOptions` et `PoolOptions` par défaut.
async fn open_pool(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    if !path.exists() {
        SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .connect()
            .await?
            .close()
            .await?;
    }
    let options = SqliteConnectOptions::new().filename(path);
    SqlitePoolOptions::new()
        .after_connect(|conn, _meta| {
            Box::pin(async move {
                let mut handle = conn.lock_handle().await?;
                // SAFETY: la connexion vient d'être ouverte et reste verrouillée pendant l'appel
                unsafe { install_guard(handle.as_raw_handle().as_ptr()) }
                    .map_err(|e| sqlx::Error::Configuration(e.into()))
            })
        })
        .connect_with(options)
        .await
}

/// Valeurs liées comme le plugin : `null`, texte, nombre (toujours en réel, SQLite le range selon
/// la colonne), le reste (booléen, tableau, objet) en texte JSON.
fn bind_values<'q>(
    query: &'q str,
    values: Vec<JsonValue>,
) -> sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>> {
    let mut query = sqlx::query(query);
    for value in values {
        if value.is_null() {
            query = query.bind(None::<JsonValue>);
        } else if let Some(text) = value.as_str() {
            query = query.bind(text.to_owned());
        } else if let Some(number) = value.as_number() {
            query = query.bind(number.as_f64().unwrap_or_default());
        } else {
            query = query.bind(value);
        }
    }
    query
}

async fn execute_on(pool: &SqlitePool, query: &str, values: Vec<JsonValue>) -> Result<(u64, i64), sqlx::Error> {
    let result = pool.execute(bind_values(query, values)).await?;
    Ok((result.rows_affected(), result.last_insert_rowid()))
}

/// Valeur lue en JSON, comme le plugin (`decode/sqlite.rs`). Le type vient de la valeur elle-même
/// (INTEGER, REAL, TEXT ou BLOB) : les branches BOOLEAN / DATE / TIME du plugin, qui dépendent du
/// type déclaré de la colonne, ne sont jamais atteintes pour une valeur non nulle.
fn to_json(value: sqlx::sqlite::SqliteValueRef<'_>) -> Result<JsonValue, String> {
    if value.is_null() {
        return Ok(JsonValue::Null);
    }
    let owned = value.to_owned();
    Ok(match value.type_info().name() {
        "TEXT" => owned.try_decode::<String>().map(JsonValue::String).unwrap_or(JsonValue::Null),
        "REAL" => owned.try_decode::<f64>().map(JsonValue::from).unwrap_or(JsonValue::Null),
        "INTEGER" | "NUMERIC" => owned
            .try_decode::<i64>()
            .map(|n| JsonValue::Number(n.into()))
            .unwrap_or(JsonValue::Null),
        "BLOB" => owned
            .try_decode::<Vec<u8>>()
            .map(|bytes| JsonValue::Array(bytes.into_iter().map(|n| JsonValue::Number(n.into())).collect()))
            .unwrap_or(JsonValue::Null),
        other => return Err(format!("unsupported datatype: {}", other)),
    })
}

async fn select_on(
    pool: &SqlitePool,
    query: &str,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    let rows = pool.fetch_all(bind_values(query, values)).await.map_err(|e| e.to_string())?;
    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let mut object = IndexMap::default();
        for (i, column) in row.columns().iter().enumerate() {
            let raw = row.try_get_raw(i).map_err(|e| e.to_string())?;
            object.insert(column.name().to_string(), to_json(raw)?);
        }
        result.push(object);
    }
    Ok(result)
}

/// Commande : ouvre la base du compte (`sqlite:nyxplayer_<uuid>.db`) dans le dossier de l'app.
#[tauri::command]
pub async fn nyx_db_load(
    app: tauri::AppHandle,
    databases: State<'_, NyxDatabases>,
    db: String,
) -> Result<String, String> {
    let file_name = database_file_name(&db)?;
    // Même dossier que le plugin SQL (et que le Rust : identique sur Windows et Android)
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| sanitize_error_path(format!("No App config path was found: {}", e)))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| sanitize_error_path(format!("Couldn't create app config dir: {}", e)))?;
    // Réinitialisation restée à moitié (fichier tenu) : suppression terminée avant l'ouverture.
    // Même dossier que `full_reset` (dossier des données, identique à celui-ci sous Windows et Android)
    if let Ok(data_dir) = app.path().app_data_dir() {
        finish_pending_reset(&data_dir, file_name);
    }
    let pool = open_pool(&dir.join(file_name))
        .await
        .map_err(|e| sanitize_error_path(e.to_string()))?;
    databases.0.write().await.insert(db.clone(), pool);
    Ok(db)
}

/// État d'un fichier de base, vu par `nyx_db_check`.
#[derive(Debug, PartialEq, Eq)]
enum DatabaseHealth {
    /// Lisible de bout en bout
    Ok,
    /// Abîmé (en entier ou en partie) : « file is not a database », « malformed », contrôle en échec
    Corrupt,
    /// Fichier absent : une base neuve sera créée
    Missing,
    /// Pas lisible pour une autre raison (fichier tenu par un autre programme…) : rien à proposer
    Unreadable,
}

impl DatabaseHealth {
    fn as_str(&self) -> &'static str {
        match self {
            DatabaseHealth::Ok => "ok",
            DatabaseHealth::Corrupt => "corrupt",
            DatabaseHealth::Missing => "missing",
            DatabaseHealth::Unreadable => "unreadable",
        }
    }
}

/// Erreur SQLite d'une base abîmée : `SQLITE_CORRUPT` (11) ou `SQLITE_NOTADB` (26), codes étendus compris
fn is_corruption_error(error: &sqlx::Error) -> bool {
    let sqlx::Error::Database(db) = error else {
        return false;
    };
    db.code()
        .and_then(|code| code.parse::<i32>().ok())
        .map(|code| matches!(code & 0xff, ffi::SQLITE_CORRUPT | ffi::SQLITE_NOTADB))
        .unwrap_or(false)
}

/// Contrôle d'une base : `PRAGMA quick_check` sur une connexion à part,
/// non gardée (la garde refuse `PRAGMA`) et jamais donnée à la page. Lit tout le fichier : appelé
/// seulement quand la base n'a pas pu être lue, pas à chaque ouverture.
async fn check_database_file(path: &Path) -> DatabaseHealth {
    if !path.exists() {
        return DatabaseHealth::Missing;
    }
    let classify = |e: &sqlx::Error| {
        if is_corruption_error(e) {
            DatabaseHealth::Corrupt
        } else {
            DatabaseHealth::Unreadable
        }
    };
    let mut conn = match SqliteConnectOptions::new().filename(path).connect().await {
        Ok(conn) => conn,
        Err(e) => return classify(&e),
    };
    let result: Result<Vec<(String,)>, sqlx::Error> =
        sqlx::query_as("PRAGMA quick_check(1)").fetch_all(&mut conn).await;
    let _ = conn.close().await;
    match result {
        Ok(rows) if rows.len() == 1 && rows[0].0 == "ok" => DatabaseHealth::Ok,
        Ok(_) => DatabaseHealth::Corrupt,
        Err(e) => classify(&e),
    }
}

/// Un seul contrôle à la fois : chacun lit tout le fichier, une page qui en lancerait en boucle
/// saturerait le disque.
static CHECK_RUNNING: AtomicBool = AtomicBool::new(false);

/// Commande : état du fichier de la base du compte (`ok`, `corrupt`, `missing`, `unreadable`).
/// Sert à proposer la réinitialisation sur l'écran du fournisseur quand la base est abîmée.
/// Un contrôle déjà en cours : `unreadable` (rien n'est proposé sur cette réponse).
#[tauri::command]
pub async fn nyx_db_check(app: tauri::AppHandle, db: String) -> Result<String, String> {
    let file_name = database_file_name(&db)?;
    if CHECK_RUNNING.swap(true, Ordering::AcqRel) {
        return Ok(DatabaseHealth::Unreadable.as_str().to_string());
    }
    let result = check_account_database(&app, file_name).await;
    CHECK_RUNNING.store(false, Ordering::Release);
    result
}

async fn check_account_database(app: &tauri::AppHandle, file_name: &str) -> Result<String, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| sanitize_error_path(format!("No App config path was found: {}", e)))?;
    Ok(check_database_file(&dir.join(file_name)).await.as_str().to_string())
}

/// Commande : requête d'écriture. Renvoie `[lignes touchées, dernier identifiant inséré]`.
#[tauri::command]
pub async fn nyx_db_execute(
    databases: State<'_, NyxDatabases>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<(u64, i64), String> {
    let pools = databases.0.read().await;
    let pool = pools.get(&db).ok_or_else(|| format!("database {} not loaded", db))?;
    execute_on(pool, &query, values).await.map_err(|e| e.to_string())
}

/// Commande : requête de lecture. Renvoie une ligne par objet, colonnes dans l'ordre de la requête.
#[tauri::command]
pub async fn nyx_db_select(
    databases: State<'_, NyxDatabases>,
    db: String,
    query: String,
    values: Vec<JsonValue>,
) -> Result<Vec<IndexMap<String, JsonValue>>, String> {
    let pools = databases.0.read().await;
    let pool = pools.get(&db).ok_or_else(|| format!("database {} not loaded", db))?;
    select_on(pool, &query, values).await
}

/// Commande : ferme une base, ou toutes si aucun nom n'est donné (comme le plugin).
#[tauri::command]
pub async fn nyx_db_close(databases: State<'_, NyxDatabases>, db: Option<String>) -> Result<bool, String> {
    let pools = databases.0.read().await;
    match db {
        Some(name) => {
            let pool = pools.get(&name).ok_or_else(|| format!("database {} not loaded", name))?;
            pool.close().await;
        }
        None => {
            for pool in pools.values() {
                pool.close().await;
            }
        }
    }
    Ok(true)
}

/// Ferme toutes les bases à la sortie de l'app (comme le plugin), pour vider le journal WAL.
pub fn close_all_on_exit(app: &tauri::AppHandle) {
    let Some(databases) = app.try_state::<NyxDatabases>() else {
        return;
    };
    tauri::async_runtime::block_on(async {
        for pool in databases.0.read().await.values() {
            pool.close().await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    const UUID: &str = "550e8400-e29b-41d4-a716-446655440000";

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nyx-secure-db-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    async fn guarded_pool(name: &str) -> (SqlitePool, PathBuf) {
        let dir = test_dir(name);
        let pool = open_pool(&dir.join(format!("nyxplayer_{}.db", UUID))).await.unwrap();
        (pool, dir)
    }

    #[test]
    fn only_the_account_database_name_is_accepted() {
        let valid = format!("sqlite:nyxplayer_{}.db", UUID);
        assert_eq!(database_file_name(&valid).unwrap(), format!("nyxplayer_{}.db", UUID));

        for rejected in [
            // Chemin absolu : remplaçait le dossier de l'app dans le plugin
            "sqlite:C:\\Users\\x\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\a.hta",
            "sqlite:/home/x/.config/autostart/a.desktop",
            "sqlite:../nyxplayer_550e8400-e29b-41d4-a716-446655440000.db",
            "sqlite:dir/nyxplayer_550e8400-e29b-41d4-a716-446655440000.db",
            "sqlite:nyxplayer.db",
            "sqlite:nyxplayer_550e8400-e29b-41d4-a716-446655440000.db?mode=rwc",
            "nyxplayer_550e8400-e29b-41d4-a716-446655440000.db",
            "mysql:nyxplayer_550e8400-e29b-41d4-a716-446655440000.db",
            "sqlite:",
        ] {
            assert!(database_file_name(rejected).is_err(), "should be rejected: {}", rejected);
        }
    }

    #[tokio::test]
    async fn file_creating_statements_are_refused_and_create_nothing() {
        let (pool, dir) = guarded_pool("attach").await;
        let target = dir.join("evil.hta");
        let path = target.to_string_lossy().replace('\'', "''");

        for query in [
            format!("ATTACH DATABASE '{}' AS evil", path),
            format!("attach '{}' as evil", path),
            format!("/* commentaire */ ATTACH '{}' AS evil", path),
            format!("-- ligne\nATTACH '{}' AS evil", path),
            format!("SELECT 1; ATTACH '{}' AS evil", path),
            format!("VACUUM INTO '{}'", path),
            format!("vacuum main into '{}'", path),
        ] {
            assert!(execute_on(&pool, &query, vec![]).await.is_err(), "should fail: {}", query);
            assert!(select_on(&pool, &query, vec![]).await.is_err(), "should fail: {}", query);
            assert!(!target.exists(), "file created by: {}", query);
        }
        // Le chemin en valeur liée ne passe pas non plus
        assert!(execute_on(&pool, "ATTACH ? AS evil", vec![json!(target.to_string_lossy())]).await.is_err());
        assert!(!target.exists());
        assert!(execute_on(&pool, "DETACH DATABASE temp", vec![]).await.is_err());

        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Témoin : sans la garde (ce que permettait le plugin), la même requête crée bien le fichier.
    /// Sans ce témoin, les refus ci-dessus pourraient venir d'autre chose que de la garde.
    #[tokio::test]
    async fn without_the_guard_attach_creates_the_file() {
        let dir = test_dir("control");
        let options = SqliteConnectOptions::new()
            .filename(dir.join(format!("nyxplayer_{}.db", UUID)))
            .create_if_missing(true);
        let pool = SqlitePool::connect_with(options).await.unwrap();
        let target = dir.join("evil.hta");
        let query = format!("/* commentaire */ ATTACH '{}' AS evil; CREATE TABLE evil.t (x)", target.to_string_lossy());
        execute_on(&pool, &query, vec![]).await.unwrap();
        assert!(target.exists());
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn pragmas_and_extensions_are_refused() {
        let (pool, dir) = guarded_pool("pragma").await;
        for query in [
            "PRAGMA journal_mode = DELETE",
            "PRAGMA writable_schema = ON",
            "pragma table_info(meta)",
            "SELECT * FROM pragma_table_info('meta')",
            "SELECT load_extension('x')",
        ] {
            assert!(select_on(&pool, query, vec![]).await.is_err(), "should fail: {}", query);
            assert!(execute_on(&pool, query, vec![]).await.is_err(), "should fail: {}", query);
        }

        // Les réglages que sqlx pose à l'ouverture, avant la garde, sont bien appliqués :
        // clés étrangères actives, comme avec le plugin
        execute_on(
            &pool,
            "CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (p INTEGER REFERENCES parent(id));",
            vec![],
        )
        .await
        .unwrap();
        let err = execute_on(&pool, "INSERT INTO child VALUES (99)", vec![]).await.unwrap_err();
        assert!(err.to_string().contains("FOREIGN KEY"), "{}", err);
        pool.close().await;

        // Base neuve créée en mode WAL, comme le plugin (Sqlite::create_database)
        let conn = rusqlite::Connection::open(dir.join(format!("nyxplayer_{}.db", UUID))).unwrap();
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode, "wal");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn normal_queries_behave_like_the_plugin() {
        let (pool, dir) = guarded_pool("normal").await;

        // Plusieurs instructions d'un coup (schéma de dbCore.ts), transactions et index
        execute_on(
            &pool,
            "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT, score REAL, n INTEGER, data BLOB, flag TEXT);
             CREATE INDEX IF NOT EXISTS idx_t_name ON t(name);",
            vec![],
        )
        .await
        .unwrap();
        execute_on(&pool, "ALTER TABLE t ADD COLUMN extra TEXT", vec![]).await.unwrap();

        let (changed, last_id) = execute_on(
            &pool,
            "INSERT INTO t (name, score, n, flag, extra) VALUES (?, ?, ?, ?, ?)",
            vec![json!("Film « été »"), json!(1.5), json!(42), json!(true), json!(null)],
        )
        .await
        .unwrap();
        assert_eq!((changed, last_id), (1, 1));
        execute_on(&pool, "INSERT INTO t (name, data) VALUES ('b', x'0102ff')", vec![]).await.unwrap();

        let rows = select_on(&pool, "SELECT id, name, score, n, flag, extra, data FROM t ORDER BY id", vec![])
            .await
            .unwrap();
        assert_eq!(rows.len(), 2);
        let first = &rows[0];
        // Ordre des colonnes gardé
        assert_eq!(first.keys().cloned().collect::<Vec<_>>(), ["id", "name", "score", "n", "flag", "extra", "data"]);
        assert_eq!(first["id"], json!(1));
        assert_eq!(first["name"], json!("Film « été »"));
        assert_eq!(first["score"], json!(1.5));
        // Nombre lié en réel, rangé en entier par la colonne INTEGER
        assert_eq!(first["n"], json!(42));
        // Booléen lié en texte JSON, comme le plugin
        assert_eq!(first["flag"], json!("true"));
        assert_eq!(first["extra"], JsonValue::Null);
        assert_eq!(rows[1]["data"], json!([1, 2, 255]));

        // Comparaison d'un nombre lié (réel) avec une colonne INTEGER
        let found = select_on(&pool, "SELECT name FROM t WHERE id = ?", vec![json!(2)]).await.unwrap();
        assert_eq!(found[0]["name"], json!("b"));

        let (changed, _) = execute_on(&pool, "DELETE FROM t WHERE id IN (?, ?)", vec![json!(1), json!(2)]).await.unwrap();
        assert_eq!(changed, 2);

        // Erreur SQL rendue en texte, comme avant (dbCore ignore « duplicate column »)
        let err = execute_on(&pool, "ALTER TABLE t ADD COLUMN extra TEXT", vec![]).await.unwrap_err();
        assert!(err.to_string().contains("duplicate column name"), "{}", err);

        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Recherche globale (`searchIndex.ts`) : table FTS5, qui lit `PRAGMA data_version` elle-même
    #[tokio::test]
    async fn fts5_search_index_still_works() {
        let (pool, dir) = guarded_pool("fts5").await;
        execute_on(
            &pool,
            "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(name, normalized_name, content_type UNINDEXED, content_id UNINDEXED, tokenize='unicode61 remove_diacritics 2')",
            vec![],
        )
        .await
        .unwrap();
        execute_on(
            &pool,
            "INSERT INTO search_index (name, normalized_name, content_type, content_id) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
            vec![json!("Matrix"), json!("matrix"), json!("movie"), json!(1), json!("Amélie"), json!("amelie"), json!("movie"), json!(2)],
        )
        .await
        .unwrap();
        let found = select_on(&pool, "SELECT content_id FROM search_index WHERE search_index MATCH ?", vec![json!("mat*")])
            .await
            .unwrap();
        assert_eq!(found.len(), 1);
        let (deleted, _) = execute_on(&pool, "DELETE FROM search_index", vec![]).await.unwrap();
        assert_eq!(deleted, 2);
        // L'exception ne vaut que pour la lecture de data_version
        assert!(execute_on(&pool, "PRAGMA data_version = 3", vec![]).await.is_err());
        assert!(select_on(&pool, "SELECT * FROM pragma_data_version", vec![]).await.is_ok());
        pool.close().await;

        // Base dont l'index a été créé par le Rust (rusqlite), comme après une ingestion
        let conn = rusqlite::Connection::open(dir.join(format!("nyxplayer_{}.db", UUID))).unwrap();
        conn.execute("INSERT INTO search_index (name, normalized_name, content_type, content_id) VALUES ('Dune', 'dune', 'movie', 3)", [])
            .unwrap();
        drop(conn);
        let pool = open_pool(&dir.join(format!("nyxplayer_{}.db", UUID))).await.unwrap();
        let found = select_on(&pool, "SELECT content_id FROM search_index WHERE search_index MATCH 'dune'", vec![]).await.unwrap();
        assert_eq!(found[0]["content_id"], json!(3));
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------------------------------
    // Index de recherche avec le schéma et les requêtes de la page
    // -----------------------------------------------------------------------------------------

    const DB_CORE_TS: &str = include_str!("../../src/services/dbCore.ts");
    const SEARCH_INDEX_TS: &str = include_str!("../../src/services/searchIndex.ts");

    /// Littéraux de chaîne ('…', "…" ou `…`) du code TS qui commencent par `start` (espaces de tête
    /// permis). Les requêtes sont ainsi lues dans le code de la page, jamais recopiées ici.
    fn ts_literals<'a>(source: &'a str, start: &str) -> Vec<&'a str> {
        let mut found = Vec::new();
        for (pos, _) in source.match_indices(start) {
            let before = source[..pos].trim_end();
            let Some(quote) = before.chars().last().filter(|c| matches!(c, '\'' | '"' | '`')) else {
                continue;
            };
            let open = before.len();
            if let Some(len) = source[pos..].find(quote) {
                found.push(&source[open..pos + len]);
            }
        }
        found
    }

    /// La seule requête de `file` qui commence par `start` ; échoue clairement si le code a changé.
    fn ts_query(source: &'static str, file: &str, start: &str) -> &'static str {
        let found = ts_literals(source, start);
        assert_eq!(
            found.len(),
            1,
            "requête « {} » introuvable ou en plusieurs exemplaires dans {} : mettre le test à jour avec le code de la page ({:?})",
            start,
            file,
            found
        );
        found[0]
    }

    /// La requête de `file` égale à `text` (requête trop courte pour être repérée par son début).
    fn ts_exact(source: &'static str, file: &str, text: &str) -> &'static str {
        ts_literals(source, text)
            .into_iter()
            .find(|q| q.trim() == text)
            .unwrap_or_else(|| panic!("requête « {} » introuvable dans {} : mettre le test à jour", text, file))
    }

    /// Remplace un morceau `${…}` d'un gabarit TS par sa valeur, comme le fait la page.
    fn fill(query: &str, part: &str, value: &str) -> String {
        assert!(query.contains(part), "« {} » absent de la requête : {}", part, query);
        query.replace(part, value)
    }

    /// Marques `?` séparées par des virgules : `chunk.map(() => '?').join(', ')` dans searchIndex.ts
    fn marks(n: usize) -> String {
        vec!["?"; n].join(", ")
    }

    /// `insertSearchRows` : un paquet de lignes `(nom, nom normalisé, type, numéro)` ; les nombres
    /// sont passés comme la page les envoie (JSON, liés en réel).
    async fn insert_rows(pool: &SqlitePool, rows: &[(&str, &str, &str, i64)]) {
        let query = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "INSERT INTO search_index");
        assert!(SEARCH_INDEX_TS.contains("batch.map(() => '(?, ?, ?, ?)').join(', ')"), "construction des lignes de insertSearchRows changée");
        let query = fill(query, "${placeholders}", &vec!["(?, ?, ?, ?)"; rows.len()].join(", "));
        let values = rows
            .iter()
            .flat_map(|(name, normalized, kind, id)| [json!(name), json!(normalized), json!(kind), json!(id)])
            .collect();
        let (inserted, _) = execute_on(pool, &query, values).await.expect("insertion refusée");
        assert_eq!(inserted as usize, rows.len());
    }

    /// `searchContent` : `mot1* mot2*` sur le nom normalisé, triés par pertinence. La chaîne
    /// `fts_query` est écrite à la main, comme la page la construit (`words.map(w => `${w}*`)`).
    async fn search(pool: &SqlitePool, fts_query: &str, limit: i64) -> Vec<(String, String, f64)> {
        let query = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "SELECT content_id, name, content_type");
        assert!(query.contains("normalized_name MATCH ?") && query.contains("ORDER BY rank"), "recherche changée : {}", query);
        select_on(pool, query, vec![json!(fts_query), json!(limit)])
            .await
            .expect("recherche refusée")
            .into_iter()
            .map(|r| {
                (
                    r["content_type"].as_str().unwrap().to_string(),
                    r["name"].as_str().unwrap().to_string(),
                    // Numéro lié en réel à l'insertion (comme par la page) : relu en nombre
                    r["content_id"].as_f64().unwrap(),
                )
            })
            .collect()
    }

    async fn rowids(pool: &SqlitePool) -> Vec<i64> {
        select_on(pool, "SELECT rowid FROM search_index ORDER BY rowid", vec![])
            .await
            .unwrap()
            .iter()
            .map(|r| r["rowid"].as_i64().unwrap())
            .collect()
    }

    /// Schéma exact de dbCore.ts et requêtes exactes de searchIndex.ts, par le pool gardé : aucune
    /// n'est refusée par la garde, et chacune fait ce que la page attend (reconstruction, recherche
    /// par début de mot et tri, reconstruction à côté de l'ancien index, mise à jour ligne à ligne).
    #[tokio::test]
    async fn search_index_with_the_page_schema_and_queries() {
        let (pool, dir) = guarded_pool("fts5-page").await;
        let schema = ts_query(DB_CORE_TS, "dbCore.ts", "CREATE VIRTUAL TABLE IF NOT EXISTS search_index");
        // Exécuté à chaque ouverture de la base : deux fois sans erreur
        execute_on(&pool, schema, vec![]).await.expect("création de search_index refusée");
        execute_on(&pool, schema, vec![]).await.expect("seconde création de search_index refusée");

        // rebuildSearchIndex : vidage puis insertion par type
        let clear = ts_exact(SEARCH_INDEX_TS, "searchIndex.ts", "DELETE FROM search_index");
        execute_on(&pool, clear, vec![]).await.expect("vidage refusé");
        insert_rows(
            &pool,
            &[
                ("Spider-Man", "spiderman", "movie", 1),
                ("Spider-Man 2", "spiderman 2", "movie", 2),
                ("Amélie", "amelie", "movie", 3),
            ],
        )
        .await;
        insert_rows(&pool, &[("The Batman", "the batman", "series", 10)]).await;
        insert_rows(&pool, &[("BFM TV", "bfm tv", "live", 20)]).await;

        // Recherche par début de mot, sur le nom normalisé ; le plus court (plus pertinent) d'abord
        let spider = search(&pool, "spider*", 100).await;
        assert_eq!(
            spider,
            vec![
                ("movie".to_string(), "Spider-Man".to_string(), 1.0),
                ("movie".to_string(), "Spider-Man 2".to_string(), 2.0)
            ]
        );
        assert_eq!(search(&pool, "spider* 2*", 100).await, vec![("movie".to_string(), "Spider-Man 2".to_string(), 2.0)]);
        assert_eq!(search(&pool, "amel*", 100).await, vec![("movie".to_string(), "Amélie".to_string(), 3.0)]);
        assert_eq!(search(&pool, "bat*", 100).await, vec![("series".to_string(), "The Batman".to_string(), 10.0)]);
        assert_eq!(search(&pool, "spider*", 1).await.len(), 1, "LIMIT lié par la page");
        assert!(search(&pool, "zorro*", 100).await.is_empty());

        // rebuildBesideOldRows : nouvelles lignes à côté des anciennes, puis retrait des anciennes
        let last = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "SELECT rowid FROM search_index ORDER BY rowid DESC");
        let max_old = select_on(&pool, last, vec![]).await.expect("dernier numéro de ligne refusé")[0]["rowid"].clone();
        assert_eq!(max_old, json!(5));
        insert_rows(&pool, &[("Spider-Man: No Way Home", "spiderman no way home", "movie", 1)]).await;
        // Pendant la reconstruction, l'ancien et le nouveau titre sont trouvés tous deux
        assert_eq!(search(&pool, "spider*", 100).await.len(), 3);
        let remove_old = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "DELETE FROM search_index WHERE rowid <=");
        let (removed, _) = execute_on(&pool, remove_old, vec![max_old.clone()]).await.expect("retrait des anciennes lignes refusé");
        assert_eq!(removed, 5);
        assert_eq!(rowids(&pool).await, vec![6]);
        assert_eq!(
            search(&pool, "spider*", 100).await,
            vec![("movie".to_string(), "Spider-Man: No Way Home".to_string(), 1.0)]
        );

        // Reconstruction arrêtée en route : retrait de ce qu'elle a ajouté (au-delà de l'ancien maximum)
        insert_rows(&pool, &[("Dune", "dune", "movie", 4)]).await;
        let undo = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "DELETE FROM search_index WHERE rowid >");
        let (undone, _) = execute_on(&pool, undo, vec![json!(6)]).await.expect("retour arrière refusé");
        assert_eq!(undone, 1);
        assert_eq!(rowids(&pool).await, vec![6]);

        // applyPendingSearchChanges : lignes d'un paquet de numéros retrouvées puis supprimées
        insert_rows(&pool, &[("Dune", "dune", "movie", 4), ("Arte", "arte", "live", 4)]).await;
        let lookup = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "SELECT rowid FROM search_index WHERE content_type = ?");
        let lookup = fill(lookup, "${marks}", &marks(2));
        let old = select_on(&pool, &lookup, vec![json!("movie"), json!(1), json!(4)]).await.expect("recherche des lignes refusée");
        let old: Vec<JsonValue> = old.iter().map(|r| r["rowid"].clone()).collect();
        assert_eq!(old.len(), 2, "le film 4 et le film 1, pas la chaîne 4");
        let delete = ts_query(SEARCH_INDEX_TS, "searchIndex.ts", "DELETE FROM search_index WHERE rowid IN (");
        let delete = fill(delete, "${rowids.map(() => '?').join(', ')}", &marks(old.len()));
        let (deleted, _) = execute_on(&pool, &delete, old).await.expect("suppression par numéro de ligne refusée");
        assert_eq!(deleted, 2);
        assert!(search(&pool, "dune*", 100).await.is_empty());
        assert_eq!(search(&pool, "arte*", 100).await, vec![("live".to_string(), "Arte".to_string(), 4.0)]);

        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn triggers_and_views_cannot_be_planted() {
        let (pool, dir) = guarded_pool("trigger").await;
        execute_on(&pool, "CREATE TABLE t (x)", vec![]).await.unwrap();
        for query in [
            "CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END",
            "CREATE TEMP TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END",
            "CREATE VIEW v AS SELECT x FROM t",
            "CREATE TEMP VIEW v AS SELECT x FROM t",
        ] {
            assert!(execute_on(&pool, query, vec![]).await.is_err(), "should fail: {}", query);
        }
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn existing_database_written_by_rust_is_readable() {
        let dir = test_dir("existing");
        let path = dir.join(format!("nyxplayer_{}.db", UUID));
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE movies (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO movies VALUES (7, 'x');")
                .unwrap();
        }
        let pool = open_pool(&path).await.unwrap();
        let rows = select_on(&pool, "SELECT id, name FROM movies", vec![]).await.unwrap();
        assert_eq!(rows[0]["id"], json!(7));
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }

    // Base abîmée reconnue, pour proposer la réinitialisation sur l'écran du fournisseur

    #[tokio::test]
    async fn database_check_tells_a_sound_base_from_a_missing_one() {
        let (pool, dir) = guarded_pool("check-ok").await;
        execute_on(&pool, "CREATE TABLE t (v TEXT)", vec![]).await.unwrap();
        pool.close().await;
        let path = dir.join(format!("nyxplayer_{}.db", UUID));
        assert_eq!(check_database_file(&path).await, DatabaseHealth::Ok);
        assert_eq!(check_database_file(&dir.join("absent.db")).await, DatabaseHealth::Missing);
    }

    #[tokio::test]
    async fn database_check_reports_a_file_that_is_not_a_database() {
        let dir = test_dir("check-notadb");
        let path = dir.join(format!("nyxplayer_{}.db", UUID));
        let garbage: Vec<u8> = (0..16384u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        std::fs::write(&path, garbage).unwrap();
        assert_eq!(check_database_file(&path).await, DatabaseHealth::Corrupt);
    }

    #[tokio::test]
    async fn database_check_reports_a_base_damaged_in_part() {
        let dir = test_dir("check-partial");
        let path = dir.join(format!("nyxplayer_{}.db", UUID));
        // Journal classique (pas de WAL) : tout est dans le fichier à la fermeture, sans dépendre du repli du WAL
        let mut conn = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete)
            .connect()
            .await
            .unwrap();
        sqlx::query("CREATE TABLE t (v TEXT)").execute(&mut conn).await.unwrap();
        for i in 0..400 {
            sqlx::query("INSERT INTO t (v) VALUES (?)")
                .bind(format!("{:0>300}", i))
                .execute(&mut conn)
                .await
                .unwrap();
        }
        conn.close().await.unwrap();
        // On abîme quelques pages au milieu, l'en-tête reste bon
        let mut bytes = std::fs::read(&path).unwrap();
        assert!(bytes.len() > 4096 * 8, "base trop petite pour le test: {}", bytes.len());
        for b in &mut bytes[4096 * 3..4096 * 5] {
            *b = 0xA5;
        }
        std::fs::write(&path, bytes).unwrap();
        assert_eq!(check_database_file(&path).await, DatabaseHealth::Corrupt);
    }

}
