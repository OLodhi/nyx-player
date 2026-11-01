//! Journal Rust (`env_logger`, sortie d'erreur) : niveau `Info` par défaut, modules réglables par
//! `RUST_LOG`, sauf le plugin mpv de l'ordinateur.
//!
//! Aux niveaux `debug` et `trace`, `tauri-plugin-mpv` écrit chaque commande envoyée à mpv, adresse
//! complète du flux comprise (`loadfile`), donc les identifiants du fournisseur IPTV. Ces lignes
//! sont coupées quel que soit `RUST_LOG`, même pour un sous-module (`tauri_plugin_mpv::ipc=trace`),
//! qu'une simple règle par module de `env_logger` ne couvrirait pas (la règle la plus précise gagne).

use log::{Level, LevelFilter, Log, Metadata, Record};

/// Crate dont les lignes plus bavardes que `Info` peuvent contenir l'adresse d'un flux.
const MPV_PLUGIN: &str = "tauri_plugin_mpv";

/// Vrai pour une ligne `debug` ou `trace` du plugin mpv (ou de l'un de ses modules).
fn is_hidden(metadata: &Metadata) -> bool {
    let target = metadata.target();
    let from_mpv_plugin = target == MPV_PLUGIN
        || target.strip_prefix(MPV_PLUGIN).is_some_and(|rest| rest.starts_with("::"));
    from_mpv_plugin && metadata.level() > Level::Info
}

/// `env_logger` dont les lignes du plugin mpv s'arrêtent au niveau `Info`.
struct GuardedLogger(env_logger::Logger);

impl Log for GuardedLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        !is_hidden(metadata) && self.0.enabled(metadata)
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            self.0.log(record);
        }
    }

    fn flush(&self) {
        self.0.flush();
    }
}

/// Réglages de l'app posés sur `builder` (déjà rempli par `RUST_LOG`) : niveau général `Info`,
/// horodatage à la milliseconde, garde du plugin mpv.
fn guarded(mut builder: env_logger::Builder) -> (GuardedLogger, LevelFilter) {
    builder.filter_level(LevelFilter::Info).format_timestamp_millis();
    let logger = builder.build();
    let max_level = logger.filter();
    (GuardedLogger(logger), max_level)
}

/// Installe le journal de l'app (une fois par processus ; un second appel ne change rien).
pub fn init() {
    let (logger, max_level) = guarded(env_logger::Builder::from_default_env());
    if log::set_boxed_logger(Box::new(logger)).is_ok() {
        log::set_max_level(max_level);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logger_for(rust_log: &str) -> GuardedLogger {
        let mut builder = env_logger::Builder::new();
        builder.parse_filters(rust_log);
        guarded(builder).0
    }

    fn enabled(logger: &GuardedLogger, target: &str, level: Level) -> bool {
        logger.enabled(&Metadata::builder().target(target).level(level).build())
    }

    #[test]
    fn rust_log_cannot_turn_on_mpv_plugin_command_traces() {
        // Seules les directives ciblées comptent : un niveau général (« trace », « debug ») est de
        // toute façon ramené à Info par `guarded`, il ne prouverait rien ici.
        for rust_log in ["tauri_plugin_mpv=trace", "tauri_plugin_mpv::ipc=trace", "tauri_plugin_mpv=debug"] {
            let logger = logger_for(rust_log);
            for target in ["tauri_plugin_mpv", "tauri_plugin_mpv::ipc", "tauri_plugin_mpv::events"] {
                assert!(!enabled(&logger, target, Level::Trace), "{rust_log} : trace visible pour {target}");
                assert!(!enabled(&logger, target, Level::Debug), "{rust_log} : debug visible pour {target}");
            }
        }
    }

    #[test]
    fn mpv_plugin_info_and_errors_still_show() {
        let logger = logger_for("");
        assert!(enabled(&logger, "tauri_plugin_mpv::ipc", Level::Error));
        assert!(enabled(&logger, "tauri_plugin_mpv::events", Level::Info));
    }

    #[test]
    fn other_modules_keep_their_rust_log_level() {
        let logger = logger_for("nyxplayer_lib::ingestion=debug,tauri_plugin_mpvx=trace");
        assert!(enabled(&logger, "nyxplayer_lib::ingestion", Level::Debug));
        // Un autre crate dont le nom commence pareil n'est pas concerné
        assert!(enabled(&logger, "tauri_plugin_mpvx", Level::Trace));
        // Par défaut : Info, comme avant
        assert!(enabled(&logger, "nyxplayer_lib::secure_db", Level::Info));
        assert!(!enabled(&logger, "nyxplayer_lib::secure_db", Level::Debug));
    }
}
