use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use regex::Regex;
use tauri::Manager;

/// Returns the app data directory path for IPTV data storage.
pub fn get_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
}

/// Valide que db_name est un nom de fichier SQLite légitime (anti-path-traversal).
/// Format attendu : `nyxplayer_{uuid}.db`, uuid en minuscules sous sa forme 8-4-4-4-12
/// (identifiant Supabase) : 36 tirets ou un autre découpage sont refusés.
pub fn validate_db_name(db_name: &str) -> Result<(), String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^nyxplayer_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.db$").unwrap());
    if !re.is_match(db_name) {
        return Err(format!("Invalid database name rejected: {}", db_name));
    }
    Ok(())
}

/// Masque les chemins filesystem dans les messages d'erreur IPC.
/// Remplace `C:\Users\xxx\AppData\...\` par `[…]/` pour éviter de fuiter
/// le nom d'utilisateur Windows dans les erreurs retournées au frontend.
pub fn sanitize_error_path(msg: String) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        // Match Windows paths (C:\...\) et Unix paths (/home/.../...)
        Regex::new(r"[A-Za-z]:\\(?:[^\s\\]+\\)+|/(?:[^\s/]+/){2,}").unwrap()
    });
    re.replace_all(&msg, "[…]/").to_string()
}

/// Masque les credentials Xtream dans les URLs pour le logging Rust.
/// Miroir de `sanitizeIptvUrl()` du frontend TypeScript.
/// Couvre : `?username=X&password=Y` (aussi encodé : `%3Fusername%3DX%26password%3DY`), les jetons
/// d'une adresse tierce (guide EPG, flux HLS : `token`, `key`, `apikey`, `auth`, `pass`, `pwd`,
/// `signature`), `/{live|movie|series|timeshift|hls|play}/USER/PASS/…` quelle que soit la casse (aussi encodé : `%2Flive%2F…`), la forme courte
/// `host:port/USER/PASS/123` et sa variante sans port (seule dans son adresse ; un premier segment
/// fait d'un seul chiffre est épargné : `/3/movie/550` reste lisible), `USER:PASS@host`, `USER@host` et `"password":"…"`
/// (JSON), y compris la forme sans port, en majuscules ou encodée.
pub fn sanitize_url_for_log(url: &str) -> String {
    static RE_QUERY: OnceLock<Regex> = OnceLock::new();
    static RE_QUERY_ENCODED: OnceLock<Regex> = OnceLock::new();
    static RE_PATH: OnceLock<Regex> = OnceLock::new();
    static RE_PATH_ENCODED: OnceLock<Regex> = OnceLock::new();
    static RE_SHORT: OnceLock<Regex> = OnceLock::new();
    static RE_SHORT_NO_PORT: OnceLock<Regex> = OnceLock::new();
    static RE_USERINFO: OnceLock<Regex> = OnceLock::new();
    static RE_USER_ONLY: OnceLock<Regex> = OnceLock::new();
    static RE_JSON: OnceLock<Regex> = OnceLock::new();
    let re_query = RE_QUERY.get_or_init(|| {
        Regex::new(r#"(?i)([?&])(username|password|token|key|apikey|auth|pass|pwd|signature)=[^&\s"'#]*"#).unwrap()
    });
    // Valeur encodée : tout jusqu'au `%26` (« & ») suivant, les autres caractères encodés compris
    let re_query_encoded = RE_QUERY_ENCODED.get_or_init(|| {
        Regex::new(r#"(?i)(%3F|%26|^|[^A-Za-z0-9_%])((?:username|password|token|key|apikey|auth|pass|pwd|signature)%3D)(?:[^&\s"'#%]|%(?:[013-9A-F][0-9A-F]|2[0-57-9A-F]))*"#).unwrap()
    });
    let re_path = RE_PATH.get_or_init(|| {
        Regex::new(r"(?i)/(live|movie|series|timeshift|hls|play)/[^/\s]+/[^/\s]+/").unwrap()
    });
    // Même chemin encodé (`%2F` = « / ») : adresse de flux placée dans une autre adresse
    let re_path_encoded = RE_PATH_ENCODED.get_or_init(|| {
        Regex::new(r"(?i)(%2F(?:live|movie|series|timeshift|hls|play)%2F)(?:[^%/\s&]|%(?:[013-9A-F][0-9A-F]|2[0-9A-E]))+%2F(?:[^%/\s&]|%(?:[013-9A-F][0-9A-F]|2[0-9A-E]))+%2F").unwrap()
    });
    let re_short = RE_SHORT.get_or_init(|| {
        Regex::new(r"(://[^/\s:@]+:\d+)/[^/\s?#]+/[^/\s?#]+/(\d+(?:\.[A-Za-z0-9]{1,8})?)\b").unwrap()
    });
    let re_short_no_port = RE_SHORT_NO_PORT.get_or_init(|| {
        Regex::new(r#"(://[^/\s:@]+)/(?:[^/\s?#\d][^/\s?#]*|\d[^/\s?#]+)/[^/\s?#]+/(\d+(?:\.[A-Za-z0-9]{1,8})?)(\.?(?:$|[^A-Za-z0-9_.~%/-])|/(?:$|\s))"#).unwrap()
    });
    let re_userinfo = RE_USERINFO.get_or_init(|| {
        Regex::new(r"(://)[^/\s:@]+:[^/\s@]+@").unwrap()
    });
    let re_user_only = RE_USER_ONLY.get_or_init(|| Regex::new(r"(://)[^/\s:@]+@").unwrap());
    let re_json = RE_JSON.get_or_init(|| {
        Regex::new(r#"(?i)("(?:username|password)"\s*:\s*")(?:[^"\\]|\\.)*""#).unwrap()
    });
    let result = re_path.replace_all(url, "/$1/***/***/");
    let result = re_path_encoded.replace_all(&result, "${1}***%2F***%2F");
    let result = re_short.replace_all(&result, "$1/***/***/$2");
    let result = re_short_no_port.replace_all(&result, "$1/***/***/$2$3");
    let result = re_userinfo.replace_all(&result, "$1***:***@");
    let result = re_user_only.replace_all(&result, "$1***@");
    let result = re_query.replace_all(&result, "$1$2=***");
    let result = re_query_encoded.replace_all(&result, "$1$2***");
    re_json.replace_all(&result, "$1***\"").to_string()
}

/// Marque laissée quand la réinitialisation n'a pas pu supprimer la base (fichier tenu par un autre
/// programme sous Windows) : la suppression est terminée au chargement suivant de cette base.
fn pending_delete_marker(dir: &Path, db_name: &str) -> PathBuf {
    dir.join(format!("{}.delete-pending", db_name))
}

/// Fichiers SQLite d'une base : la base, son journal WAL et sa mémoire partagée.
fn database_files(db_name: &str) -> [String; 3] {
    [db_name.to_string(), format!("{}-wal", db_name), format!("{}-shm", db_name)]
}

/// Termine une réinitialisation restée à moitié : appelé au chargement de la base par la
/// page, avant toute ouverture. Sans marque, ne fait rien. Un seul essai : la marque est retirée même
/// si un fichier résiste encore, sinon elle effacerait au lancement suivant la base remplie entre-temps
/// (reprises pas encore envoyées, effacement du cloud en attente).
pub fn finish_pending_reset(dir: &Path, db_name: &str) {
    if validate_db_name(db_name).is_err() {
        return;
    }
    let marker = pending_delete_marker(dir, db_name);
    if !marker.exists() {
        return;
    }
    let mut all_removed = true;
    for file in database_files(db_name) {
        let path = dir.join(&file);
        if path.exists() && fs::remove_file(&path).is_err() {
            all_removed = false;
        }
    }
    let _ = fs::remove_file(&marker);
    if all_removed {
        log::info!("[Full Reset] Suppression de la base terminée au lancement");
    } else {
        log::warn!("[Full Reset] Base toujours tenue au lancement : elle est gardée telle quelle");
    }
}

/// Supprime physiquement tous les fichiers de données (SQLite + legacy JSON).
/// Le frontend doit d'abord fermer la connexion SQLite (closeDatabaseConnection),
/// nettoyer localStorage/keychain/Cache API, puis appeler cette commande.
/// Après retour, le frontend relance l'app via tauri-plugin-process.
///
/// Commande asynchrone : une commande synchrone tourne sur le fil principal, et les
/// attentes entre deux essais de suppression y figeaient l'écran.
#[tauri::command]
pub async fn full_reset(app: tauri::AppHandle, db_name: String) -> Result<(), String> {
    validate_db_name(&db_name)?;
    let data_dir = get_data_dir(&app);

    // Supprimer les fichiers SQLite (DB + WAL + SHM)
    // Retry up to 3 times with 200ms delay for Windows file handle release.
    // WebView2 or the page's database connection may still hold a handle briefly after
    // the JS-side closeDatabaseConnection() call.
    for file in &database_files(&db_name) {
        let path = data_dir.join(file);
        if path.exists() {
            let mut deleted = false;
            for attempt in 1..=3 {
                match fs::remove_file(&path) {
                    Ok(_) => {
                        deleted = true;
                        break;
                    }
                    Err(e) if attempt < 3 => {
                        log::warn!("[Full Reset] Retry {}/3 for {} ({})", attempt, file, e);
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                    Err(e) => {
                        // Base gardée alors que le coffre et les réglages sont vidés : sa suppression
                        // est notée pour le prochain chargement de la base
                        if let Err(marker_err) = fs::write(pending_delete_marker(&data_dir, &db_name), b"") {
                            log::warn!("[Full Reset] Marque de suppression non écrite : {}", sanitize_error_path(marker_err.to_string()));
                        }
                        return Err(sanitize_error_path(format!("Failed to delete {} after 3 attempts: {}", file, e)));
                    }
                }
            }
            if deleted {
                log::info!("[Full Reset] Deleted: {}", file);
            }
        }
    }

    // Supprimer le fichier legacy
    let legacy = data_dir.join("iptv_data.json");
    if legacy.exists() {
        fs::remove_file(&legacy).map_err(|e| sanitize_error_path(format!("Failed to delete iptv_data.json: {}", e)))?;
        log::info!("[Full Reset] Deleted: iptv_data.json");
    }

    log::info!("[Full Reset] All data files removed");
    Ok(())
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_db_name_accepted() {
        assert!(validate_db_name("nyxplayer_550e8400-e29b-41d4-a716-446655440000.db").is_ok());
    }

    #[test]
    fn valid_db_name_lowercase_hex() {
        assert!(validate_db_name("nyxplayer_abcdef01-2345-6789-abcd-ef0123456789.db").is_ok());
    }

    #[test]
    fn path_traversal_rejected() {
        assert!(validate_db_name("../../Windows/system32.dll").is_err());
    }

    #[test]
    fn dotdot_in_name_rejected() {
        assert!(validate_db_name("nyxplayer_../../../etc.db").is_err());
    }

    #[test]
    fn empty_name_rejected() {
        assert!(validate_db_name("").is_err());
    }

    #[test]
    fn uppercase_uuid_rejected() {
        assert!(validate_db_name("nyxplayer_550E8400-E29B-41D4-A716-446655440000.db").is_err());
    }

    #[test]
    fn wrong_prefix_rejected() {
        assert!(validate_db_name("malicious_550e8400-e29b-41d4-a716-446655440000.db").is_err());
    }

    #[test]
    fn no_extension_rejected() {
        assert!(validate_db_name("nyxplayer_550e8400-e29b-41d4-a716-446655440000").is_err());
    }

    #[test]
    fn slash_in_name_rejected() {
        assert!(validate_db_name("nyxplayer_abc/def01-2345-6789-abcd-ef0123456789.db").is_err());
    }

    #[test]
    fn name_not_shaped_like_a_uuid_rejected() {
        assert!(validate_db_name("nyxplayer_------------------------------------.db").is_err());
        assert!(validate_db_name("nyxplayer_550e8400e29b-41d4-a716-446655440000-.db").is_err());
        assert!(validate_db_name("nyxplayer_550e8400-e29b-41d4-a716-446655440000\n.db").is_err());
    }

    #[test]
    fn backslash_in_name_rejected() {
        assert!(validate_db_name("nyxplayer_abc\\def01-2345-6789-abcd-ef012345678.db").is_err());
    }

    // ===== sanitize_error_path =====

    #[test]
    fn sanitize_strips_windows_path() {
        let msg = "Failed to open DB: C:\\Users\\jdupont\\AppData\\Roaming\\com.nyxplayer.app\\nyxplayer_xxx.db".to_string();
        let result = sanitize_error_path(msg);
        assert!(!result.contains("jdupont"), "Username should be stripped");
        assert!(result.contains("nyxplayer_xxx.db"), "Filename should be kept");
        assert!(result.contains("[…]/"), "Path should be replaced with marker");
    }

    #[test]
    fn sanitize_no_path_unchanged() {
        let msg = "Transaction commit failed: database is locked".to_string();
        let result = sanitize_error_path(msg.clone());
        assert_eq!(result, msg);
    }

    #[test]
    fn sanitize_strips_unix_path() {
        let msg = "Failed: /home/user/.local/share/com.nyxplayer.app/test.db".to_string();
        let result = sanitize_error_path(msg);
        assert!(!result.contains("/home/user"), "Unix path should be stripped");
    }

    #[test]
    fn sanitize_multiple_paths() {
        let msg = "Copy C:\\Users\\a\\src.db to C:\\Users\\a\\dst.db failed".to_string();
        let result = sanitize_error_path(msg);
        assert!(!result.contains("Users\\a"), "Both paths should be stripped");
    }

    #[test]
    fn sanitize_preserves_error_context() {
        let msg = "Failed to delete file after 3 attempts: C:\\Users\\test\\AppData\\x.db (os error 32)".to_string();
        let result = sanitize_error_path(msg);
        assert!(result.contains("Failed to delete file"), "Prefix kept");
        assert!(result.contains("os error 32"), "Error code kept");
        assert!(!result.contains("Users\\test"), "Path stripped");
    }

    // ===== sanitize_url_for_log =====

    #[test]
    fn sanitize_url_query_params() {
        let url = "http://provider.com/xmltv.php?username=john&password=secret123";
        let result = sanitize_url_for_log(url);
        assert_eq!(result, "http://provider.com/xmltv.php?username=***&password=***");
    }

    #[test]
    fn sanitize_url_xtream_path() {
        let url = "http://host.com/live/myuser/mypass/12345.ts";
        let result = sanitize_url_for_log(url);
        assert!(result.contains("/live/***/***/"), "Credentials stripped from path");
        assert!(result.contains("12345.ts"), "Stream ID kept");
    }

    #[test]
    fn sanitize_url_no_credentials() {
        let url = "http://epg.provider.com/guide.xml.gz";
        let result = sanitize_url_for_log(url);
        assert_eq!(result, url, "URL without credentials unchanged");
    }

    #[test]
    fn sanitize_url_case_insensitive() {
        let url = "http://host.com/api?Username=admin&Password=123";
        let result = sanitize_url_for_log(url);
        assert!(!result.contains("admin"), "Username stripped (case insensitive)");
        assert!(!result.contains("123"), "Password stripped (case insensitive)");
    }

    #[test]
    fn sanitize_url_timeshift_short_userinfo_and_json_forms() {
        assert_eq!(
            sanitize_url_for_log("http://h.com:8080/timeshift/john/secret/60/2026-09-28:20-00/1.ts"),
            "http://h.com:8080/timeshift/***/***/60/2026-09-28:20-00/1.ts"
        );
        assert_eq!(
            sanitize_url_for_log("http://h.com/john/secret/123.mpegts"),
            "http://h.com/***/***/123.mpegts"
        );
        assert_eq!(
            sanitize_url_for_log("http://h.com:8080/john/secret/123.ts"),
            "http://h.com:8080/***/***/123.ts"
        );
        assert_eq!(
            sanitize_url_for_log("http://john:secret@h.com:8080/get.php"),
            "http://***:***@h.com:8080/get.php"
        );
        assert_eq!(
            sanitize_url_for_log(r#"{"username":"john","password":"secret","auth":1}"#),
            r#"{"username":"***","password":"***","auth":1}"#
        );
        let msg = "a http://h.com/live/u1/p1/1.ts b http://h.com/live/u2/p2/2.ts";
        let out = sanitize_url_for_log(msg);
        assert!(!out.contains("u1") && !out.contains("p2"), "All URLs masked: {out}");
        // Escaped quote inside the value: the whole password is masked, not just its start.
        assert_eq!(
            sanitize_url_for_log(r#"{"password":"ab\"cdSECRET","auth":1}"#),
            r#"{"password":"***","auth":1}"#
        );
        let tmdb = "https://api.themoviedb.org/3/tv/1399/season/1";
        assert_eq!(sanitize_url_for_log(tmdb), tmdb, "TMDB URL unchanged");
    }

    /// Jetons d'une adresse tierce, identifiant sans mot de passe, chemins `/hls/` et `/play/` :
    /// miroir des tests TypeScript.
    #[test]
    fn sanitize_url_tokens_user_only_and_hls_play_forms() {
        assert_eq!(
            sanitize_url_for_log("http://h.example/live/U/P/1.ts?token=X"),
            "http://h.example/live/***/***/1.ts?token=***"
        );
        assert_eq!(
            sanitize_url_for_log("https://epg.example/guide.xml?key=Abc123&lang=fr"),
            "https://epg.example/guide.xml?key=***&lang=fr"
        );
        assert_eq!(
            sanitize_url_for_log("https://epg.example/g.xml?AUTH=a&apikey=b&pass=d&pwd=e&signature=f"),
            "https://epg.example/g.xml?AUTH=***&apikey=***&pass=***&pwd=***&signature=***"
        );
        assert_eq!(
            sanitize_url_for_log("go?u=http%3A%2F%2Fepg.example%2Fg.xml%3Ftoken%3DSecret%26lang%3Dfr"),
            "go?u=http%3A%2F%2Fepg.example%2Fg.xml%3Ftoken%3D***%26lang%3Dfr"
        );
        // Un paramètre dont le nom ne fait que contenir « key » reste lisible
        let plain = "https://h.example/x?monkey=1&sort_key=2";
        assert_eq!(sanitize_url_for_log(plain), plain);
        assert_eq!(
            sanitize_url_for_log("http://John@h.example/get.php"),
            "http://***@h.example/get.php"
        );
        assert_eq!(
            sanitize_url_for_log("http://John:Secret@h.example/x"),
            "http://***:***@h.example/x"
        );
        assert_eq!(
            sanitize_url_for_log("http://h.example/hls/John/Secret/1.m3u8"),
            "http://h.example/hls/***/***/1.m3u8"
        );
        assert_eq!(
            sanitize_url_for_log("http://h.example:8080/play/John/Secret/42"),
            "http://h.example:8080/play/***/***/42"
        );
        assert_eq!(
            sanitize_url_for_log("go?u=http%3A%2F%2Fh.example%2Fhls%2FJohn%2FSecret%2F1.m3u8"),
            "go?u=http%3A%2F%2Fh.example%2Fhls%2F***%2F***%2F1.m3u8"
        );
        let tmdb = "https://api.themoviedb.org/3/tv/1399/season/1?language=fr-FR";
        assert_eq!(sanitize_url_for_log(tmdb), tmdb, "TMDB URL unchanged");
    }

    // Réinitialisation restée à moitié, terminée au chargement suivant

    fn reset_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nyx-storage-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const DB: &str = "nyxplayer_550e8400-e29b-41d4-a716-446655440000.db";

    #[test]
    fn pending_reset_deletes_the_base_kept_by_a_locked_file() {
        let dir = reset_dir("pending");
        for file in database_files(DB) {
            fs::write(dir.join(file), b"x").unwrap();
        }
        fs::write(pending_delete_marker(&dir, DB), b"").unwrap();
        finish_pending_reset(&dir, DB);
        for file in database_files(DB) {
            assert!(!dir.join(file).exists());
        }
        assert!(!pending_delete_marker(&dir, DB).exists());
    }

    #[test]
    fn a_file_still_held_keeps_the_base_and_forgets_the_mark() {
        let dir = reset_dir("held");
        // Un dossier au nom du journal : sa suppression comme fichier échoue, comme un fichier tenu
        fs::create_dir_all(dir.join(format!("{}-wal", DB))).unwrap();
        fs::write(dir.join(DB), b"x").unwrap();
        fs::write(pending_delete_marker(&dir, DB), b"").unwrap();
        finish_pending_reset(&dir, DB);
        // Un seul essai : la base remplie ensuite ne sera pas effacée au lancement suivant
        assert!(!pending_delete_marker(&dir, DB).exists());
        fs::write(dir.join(DB), b"base neuve").unwrap();
        finish_pending_reset(&dir, DB);
        assert_eq!(fs::read(dir.join(DB)).unwrap(), b"base neuve");
    }

    #[test]
    fn without_a_pending_reset_the_base_is_kept() {
        let dir = reset_dir("kept");
        fs::write(dir.join(DB), b"x").unwrap();
        finish_pending_reset(&dir, DB);
        assert!(dir.join(DB).exists());
    }

    /// Formes sans port, en majuscules ou encodées, miroir des tests TypeScript.
    #[test]
    fn sanitize_url_short_uppercase_and_encoded_forms() {
        // Forme courte sans port
        assert_eq!(
            sanitize_url_for_log("http://provider.example/john/secret/123.ts"),
            "http://provider.example/***/***/123.ts"
        );
        assert_eq!(
            sanitize_url_for_log("erreur http://provider.example/john/secret/123 ici"),
            "erreur http://provider.example/***/***/123 ici"
        );
        assert_eq!(
            sanitize_url_for_log("http://provider.example/12345678/87654321/42.m3u8?t=1"),
            "http://provider.example/***/***/42.m3u8?t=1"
        );
        let tmdb = "https://api.themoviedb.org/3/movie/550";
        assert_eq!(sanitize_url_for_log(tmdb), tmdb, "TMDB URL unchanged");
        // Fin de phrase ou erreur ffmpeg relayée par mpv : « 123.ts: », « 123.ts. »
        assert_eq!(
            sanitize_url_for_log("http://provider.example/jdoe/p4ss/123.ts: Server returned 404"),
            "http://provider.example/***/***/123.ts: Server returned 404"
        );
        assert_eq!(
            sanitize_url_for_log("Échec de http://provider.example/jdoe/p4ss/123.ts."),
            "Échec de http://provider.example/***/***/123.ts."
        );
        assert_eq!(
            sanitize_url_for_log("http://provider.example/jdoe/p4ss/123/"),
            "http://provider.example/***/***/123/"
        );
        let longer = "http://provider.example/a/b/123/suite";
        assert_eq!(sanitize_url_for_log(longer), longer);
        // Majuscules
        assert_eq!(
            sanitize_url_for_log("http://provider.example/LIVE/John/Secret/1.ts"),
            "http://provider.example/LIVE/***/***/1.ts"
        );
        // Paramètres encodés
        assert_eq!(
            sanitize_url_for_log("username%3DJohn%26password%3DSecret"),
            "username%3D***%26password%3D***"
        );
        assert_eq!(
            sanitize_url_for_log("http://proxy.example/go?u=http%3A%2F%2Fh.example%2Fplayer_api.php%3Fusername%3DJohn%26password%3DS%40cret%26action%3Dx"),
            "http://proxy.example/go?u=http%3A%2F%2Fh.example%2Fplayer_api.php%3Fusername%3D***%26password%3D***%26action%3Dx"
        );
        assert_eq!(sanitize_url_for_log("x%3fUSERNAME%3dJohn"), "x%3fUSERNAME%3d***");
        // Chemin de flux encodé (adresse de flux dans une autre adresse)
        assert_eq!(
            sanitize_url_for_log("go?u=http%3A%2F%2Fh.example%2Flive%2FJohn%2FSecret%2F1.ts"),
            "go?u=http%3A%2F%2Fh.example%2Flive%2F***%2F***%2F1.ts"
        );
        assert_eq!(
            sanitize_url_for_log("u=http%3a%2f%2fh.example%2fMOVIE%2fJo%40hn%2fS%2Bcret%2f2.mkv"),
            "u=http%3a%2f%2fh.example%2fMOVIE%2f***%2F***%2F2.mkv"
        );
    }
}
