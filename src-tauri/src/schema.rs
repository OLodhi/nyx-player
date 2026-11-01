//! Schema SQL — Single Source of Truth (Rust)
//!
//! Toutes les définitions CREATE TABLE et ALTER TABLE auto-repair utilisées
//! par les modules Rust sont centralisées ici. AUCUN autre fichier Rust ne doit
//! contenir de CREATE TABLE inline (sauf `migrations.rs`, journal historique gardé pour les tests).
//!
//! Quand on ajoute une colonne :
//! 1. Modifier la constante ici (CATALOG_TABLES ou EPG_TABLES)
//! 2. Ajouter l'ALTER TABLE dans CATALOG_AUTO_REPAIR ou EPG_LIVE_AUTO_REPAIR
//! 3. `cargo test` vérifiera la cohérence automatiquement

use rusqlite::Connection;

// =============================================================================
// PRAGMAS
// =============================================================================

/// PRAGMAs pour toute connexion Rust ouverte directement (hors base de la page, `secure_db.rs`).
/// WAL mode pour concurrence lecture/écriture, busy_timeout pour éviter SQLITE_BUSY.
pub const PRAGMAS_WAL: &str = "
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
";

/// PRAGMAs supplémentaires pour les ingestions batch (catalog_parser).
pub const PRAGMAS_BATCH: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = 10000;
    PRAGMA temp_store = MEMORY;
";

// =============================================================================
// CATALOG TABLES (movies, series, live, categories)
// =============================================================================

/// Crée les tables du catalogue IPTV si elles n'existent pas.
/// Source de vérité pour la structure des tables movies, series, live, categories.
pub const CATALOG_TABLES: &str = "
    CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY,
        tmdb_id INTEGER,
        name TEXT NOT NULL,
        icon TEXT,
        category_id TEXT,
        added INTEGER,
        rating REAL,
        container_extension TEXT,
        data TEXT,
        sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS series (
        id INTEGER PRIMARY KEY,
        tmdb_id INTEGER,
        name TEXT NOT NULL,
        icon TEXT,
        category_id TEXT,
        added INTEGER,
        rating REAL,
        data TEXT,
        sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS live (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT,
        category_id TEXT,
        epg_channel_id TEXT,
        matched_epg_id TEXT,
        match_method TEXT,
        geo_hint TEXT,
        data TEXT,
        sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
    );
";

// =============================================================================
// EPG TABLES (epg_programs, epg_channels)
// =============================================================================

/// Crée les tables EPG + indexes si elles n'existent pas.
/// Source de vérité pour la structure des tables epg_programs et epg_channels.
pub const EPG_TABLES: &str = "
    CREATE TABLE IF NOT EXISTS epg_programs (
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        stop_ts INTEGER NOT NULL,
        description TEXT,
        PRIMARY KEY (channel_id, start_ts)
    );
    CREATE INDEX IF NOT EXISTS idx_epg_start ON epg_programs(start_ts);
    DROP INDEX IF EXISTS idx_epg_channel_start;
    CREATE INDEX IF NOT EXISTS idx_epg_channel_stop ON epg_programs(channel_id, stop_ts);
    CREATE TABLE IF NOT EXISTS epg_channels (
        id TEXT PRIMARY KEY NOT NULL,
        display_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS epg_kept_channels (
        id TEXT PRIMARY KEY NOT NULL
    );
";

/// Table where a guide sync writes the new programs before they replace `epg_programs`
/// (epg_parser.rs, ProgramWriter): same columns and key, indexes built after the swap.
/// A leftover of a killed sync is dropped first.
pub const EPG_PROGRAMS_STAGING: &str = "
    DROP TABLE IF EXISTS epg_programs_staging;
    CREATE TABLE epg_programs_staging (
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        stop_ts INTEGER NOT NULL,
        description TEXT,
        PRIMARY KEY (channel_id, start_ts)
    );
";

// =============================================================================
// AUTO-REPAIR — colonnes ajoutées post-v1
// =============================================================================

/// Auto-repair pour les tables catalogue.
/// Chaque ALTER TABLE est exécuté avec let _ = (ignore "duplicate column").
/// Couvre les colonnes ajoutées dans les migrations v8..v16.
pub const CATALOG_AUTO_REPAIR: &[&str] = &[
    // v14: sort_order sur les 4 tables catalogue
    "ALTER TABLE movies ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE series ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE live ADD COLUMN sort_order INTEGER DEFAULT 0",
    "ALTER TABLE categories ADD COLUMN sort_order INTEGER DEFAULT 0",
    // v8: container_extension sur movies
    "ALTER TABLE movies ADD COLUMN container_extension TEXT",
    // v15: epg_channel_id sur live
    "ALTER TABLE live ADD COLUMN epg_channel_id TEXT",
    // v16+: EPG matching columns sur live
    "ALTER TABLE live ADD COLUMN matched_epg_id TEXT",
    "ALTER TABLE live ADD COLUMN match_method TEXT",
    "ALTER TABLE live ADD COLUMN geo_hint TEXT",
];

/// Auto-repair pour les colonnes EPG sur la table live.
/// Utilisé par `build_epg_mapping` quand il s'exécute de manière isolée.
pub const EPG_LIVE_AUTO_REPAIR: &[&str] = &[
    "ALTER TABLE live ADD COLUMN geo_hint TEXT",
];

// =============================================================================
// HELPER — exécuter un tableau d'auto-repair
// =============================================================================

/// Exécute une liste de ALTER TABLE en ignorant silencieusement les erreurs
/// "duplicate column name" (colonne déjà présente = pas un problème).
pub fn run_auto_repair(conn: &Connection, repairs: &[&str]) {
    for sql in repairs {
        let _ = conn.execute(sql, []);
    }
}

// =============================================================================
// TESTS — vérification de cohérence du schema
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Vérifie que CATALOG_TABLES produit les bonnes tables avec les bonnes colonnes.
    #[test]
    fn test_catalog_tables_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(CATALOG_TABLES).unwrap();

        // Verify 'live' table has all 10 columns
        let live_cols = get_column_names(&conn, "live");
        assert!(live_cols.contains(&"id".to_string()), "missing id");
        assert!(live_cols.contains(&"name".to_string()), "missing name");
        assert!(live_cols.contains(&"icon".to_string()), "missing icon");
        assert!(live_cols.contains(&"category_id".to_string()), "missing category_id");
        assert!(live_cols.contains(&"epg_channel_id".to_string()), "missing epg_channel_id");
        assert!(live_cols.contains(&"matched_epg_id".to_string()), "missing matched_epg_id");
        assert!(live_cols.contains(&"match_method".to_string()), "missing match_method");
        assert!(live_cols.contains(&"geo_hint".to_string()), "missing geo_hint");
        assert!(live_cols.contains(&"data".to_string()), "missing data");
        assert!(live_cols.contains(&"sort_order".to_string()), "missing sort_order");
        assert_eq!(live_cols.len(), 10, "live table should have exactly 10 columns, got {:?}", live_cols);

        // Verify 'movies' table
        let movies_cols = get_column_names(&conn, "movies");
        assert!(movies_cols.contains(&"container_extension".to_string()), "missing container_extension");
        assert!(movies_cols.contains(&"sort_order".to_string()), "missing sort_order");
        assert_eq!(movies_cols.len(), 10, "movies table should have 10 columns");

        // Verify 'series' table
        let series_cols = get_column_names(&conn, "series");
        assert!(series_cols.contains(&"sort_order".to_string()), "missing sort_order");
        assert_eq!(series_cols.len(), 9, "series table should have 9 columns");

        // Verify 'categories' table
        let cat_cols = get_column_names(&conn, "categories");
        assert_eq!(cat_cols.len(), 4, "categories table should have 4 columns");
    }

    /// Vérifie que EPG_TABLES produit les bonnes tables.
    #[test]
    fn test_epg_tables_schema() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(EPG_TABLES).unwrap();

        // Verify 'epg_programs'
        let prog_cols = get_column_names(&conn, "epg_programs");
        assert_eq!(prog_cols.len(), 5, "epg_programs should have 5 columns, got {:?}", prog_cols);
        assert!(prog_cols.contains(&"channel_id".to_string()));
        assert!(prog_cols.contains(&"title".to_string()));
        assert!(prog_cols.contains(&"start_ts".to_string()));
        assert!(prog_cols.contains(&"stop_ts".to_string()));
        assert!(prog_cols.contains(&"description".to_string()));

        // Verify 'epg_channels'
        let ch_cols = get_column_names(&conn, "epg_channels");
        assert_eq!(ch_cols.len(), 2, "epg_channels should have 2 columns, got {:?}", ch_cols);
        assert!(ch_cols.contains(&"id".to_string()));
        assert!(ch_cols.contains(&"display_name".to_string()));
    }

    /// La table d'attente du guide a exactement les colonnes et la clé de `epg_programs`
    /// (elle la remplace à la fin de chaque synchro).
    #[test]
    fn test_epg_staging_matches_programs() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(EPG_TABLES).unwrap();
        conn.execute_batch(EPG_PROGRAMS_STAGING).unwrap();
        let describe = |table: &str| -> Vec<(String, String, i64, i64)> {
            let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table)).unwrap();
            stmt.query_map([], |r| Ok((r.get(1)?, r.get(2)?, r.get(3)?, r.get(5)?)))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        assert_eq!(describe("epg_programs_staging"), describe("epg_programs"));
    }

    /// Vérifie que l'auto-repair fonctionne sur une DB fraîche (colonnes déjà présentes).
    #[test]
    fn test_auto_repair_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(CATALOG_TABLES).unwrap();

        // Running auto-repair on a table that already has all columns should not error
        run_auto_repair(&conn, CATALOG_AUTO_REPAIR);
        run_auto_repair(&conn, EPG_LIVE_AUTO_REPAIR);

        // Verify columns are still correct
        let live_cols = get_column_names(&conn, "live");
        assert_eq!(live_cols.len(), 10);
    }

    /// Helper : retourne les noms de colonnes d'une table.
    fn get_column_names(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table)).unwrap();
        stmt.query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }
}
