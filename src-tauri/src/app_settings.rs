//! App-level settings persisted in a JSON file.
//!
//! These settings are read BEFORE WebView2 initializes (unlike SQLite preferences),
//! so they can influence the browser engine startup flags.
//!
//! File location: `{app_config_dir}/settings.json`
//!
//! Currently supported keys:
//! - `hardware_acceleration` (bool, default: true)

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;

// ============================================================================
// TYPES
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    /// Enable GPU acceleration for WebView2 rendering and MPV hardware decoding.
    /// When false, passes `--disable-gpu` to Chromium and `--hwdec=no` to MPV.
    #[serde(default = "default_true")]
    pub hardware_acceleration: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            hardware_acceleration: true,
        }
    }
}

// ============================================================================
// READ / WRITE (pure filesystem, no Tauri dependency)
// ============================================================================

/// Read settings from `{config_dir}/settings.json`.
/// Returns defaults if the file is missing or malformed.
pub fn read_settings(config_dir: &Path) -> AppSettings {
    let path = config_dir.join("settings.json");
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            log::warn!("[AppSettings] Malformed settings.json, using defaults: {}", e);
            AppSettings::default()
        }),
        Err(_) => AppSettings::default(),
    }
}

/// Write settings to `{config_dir}/settings.json`.
///
/// Écriture atomique : le contenu part d'abord dans `settings.json.tmp`, puis un
/// renommage remplace l'ancien fichier. Un arrêt brutal pendant l'écriture laisse
/// donc l'ancien fichier intact au lieu d'un fichier tronqué.
fn write_settings(config_dir: &Path, settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(config_dir).map_err(|e| crate::storage::sanitize_error_path(format!("Failed to create config dir: {}", e)))?;
    let path = config_dir.join("settings.json");
    let tmp_path = config_dir.join("settings.json.tmp");
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Serialize error: {}", e))?;
    let write_tmp = || -> std::io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(json.as_bytes())?;
        file.sync_all()
    };
    write_tmp().map_err(|e| crate::storage::sanitize_error_path(format!("Write error: {}", e)))?;
    fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        crate::storage::sanitize_error_path(format!("Rename error: {}", e))
    })?;
    Ok(())
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Sérialise les lectures-modifications-écritures de `settings.json` (commandes asynchrones).
static SETTINGS_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Read a single app setting by key.
/// Returns the value as a string (frontend parses it).
#[tauri::command]
pub async fn get_app_setting(app: tauri::AppHandle, key: String) -> Result<String, String> {
    use tauri::Manager;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    let settings = read_settings(&config_dir);

    match key.as_str() {
        "hardware_acceleration" => Ok(settings.hardware_acceleration.to_string()),
        _ => Err(format!("Unknown app setting: {}", key)),
    }
}

/// Write a single app setting by key.
/// The frontend should call `relaunch()` after changing settings that require a restart.
#[tauri::command]
pub async fn set_app_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    use tauri::Manager;
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Path error: {}", e))?;
    // Deux enregistrements simultanés partageraient settings.json.tmp : un seul à la fois.
    let _guard = SETTINGS_WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = read_settings(&config_dir);

    match key.as_str() {
        "hardware_acceleration" => {
            settings.hardware_acceleration = value
                .parse::<bool>()
                .map_err(|_| format!("Invalid boolean value: {}", value))?;
            log::info!(
                "[AppSettings] hardware_acceleration set to {}",
                settings.hardware_acceleration
            );
        }
        _ => return Err(format!("Unknown app setting: {}", key)),
    }

    write_settings(&config_dir, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nyx-app-settings-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn write_then_read_round_trips_and_leaves_no_temp_file() {
        let dir = temp_config_dir("roundtrip");
        write_settings(&dir, &AppSettings { hardware_acceleration: false }).unwrap();
        assert!(!read_settings(&dir).hardware_acceleration);
        assert!(!dir.join("settings.json.tmp").exists());

        // Un second enregistrement remplace bien le fichier existant.
        write_settings(&dir, &AppSettings { hardware_acceleration: true }).unwrap();
        assert!(read_settings(&dir).hardware_acceleration);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn leftover_temp_file_does_not_affect_reading() {
        let dir = temp_config_dir("leftover");
        write_settings(&dir, &AppSettings { hardware_acceleration: false }).unwrap();
        // Simule un arrêt brutal pendant une écriture suivante : fichier temporaire tronqué.
        fs::write(dir.join("settings.json.tmp"), "{\"hardware_acc").unwrap();
        assert!(!read_settings(&dir).hardware_acceleration);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_or_malformed_file_falls_back_to_defaults() {
        let dir = temp_config_dir("defaults");
        assert!(read_settings(&dir).hardware_acceleration);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("settings.json"), "not json").unwrap();
        assert!(read_settings(&dir).hardware_acceleration);
        let _ = fs::remove_dir_all(&dir);
    }
}
