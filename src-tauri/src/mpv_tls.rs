//! Certificats HTTPS de mpv.exe (Windows).
//!
//! Le FFmpeg de `mpv.exe` vérifie les certificats avec OpenSSL, qui ne lit pas le magasin de
//! Windows tout seul : sans `--tls-verify=yes`, mpv acceptait n'importe quel certificat (flux
//! détournable sur un Wi-Fi public), et avec la seule option sans fichier d'autorités, tout flux
//! HTTPS échouerait. Comme sur Android (`SystemCaBundle.kt`), les autorités du
//! système sont exportées dans un fichier PEM passé à mpv (`--tls-ca-file`).
//!
//! - Vérification toujours active, et toujours avec `--tls-ca-file` : sans fichier, OpenSSL ferait
//!   confiance à ses chemins par défaut (variable `SSL_CERT_FILE`, dossier `OPENSSLDIR` compilé
//!   dans mpv.exe, créable par n'importe quel compte sur `C:\`) ; vérifié avec le vrai mpv.exe.
//!   Si l'export échoue et qu'aucun fichier d'un lancement précédent n'existe, mpv reçoit le
//!   périphérique vide (`NUL`) : aucune autorité, un flux HTTPS est refusé (message « Connexion
//!   sécurisée impossible à vérifier », `mpvBridge.ts`), jamais lu sans vérification. Les flux
//!   HTTP ne changent pas.
//! - Export au premier lancement de mpv.exe, gardé pour la durée de l'app ; un échec est retenté au
//!   lancement suivant de mpv.exe (les options ne s'appliquent qu'au démarrage du processus).
//! - OpenSSL refuse tout le fichier si un seul certificat est illisible : chaque certificat est
//!   d'abord relu (`webpki`), ceux qui échouent sont écartés.
//! - Limites connues : Windows complète son magasin « Racine » à la demande, et OpenSSL ne
//!   va pas chercher un intermédiaire manquant ; un serveur à la chaîne incomplète, accepté par
//!   Edge, peut être refusé. `rustls-native-certs` lit `SSL_CERT_FILE` / `SSL_CERT_DIR` à la place
//!   du magasin de Windows si l'une de ces variables est définie sur le PC.

// Android : libmpv exporte ses propres certificats (plugin nyx-android), seuls les tests servent
#![cfg_attr(mobile, allow(dead_code))]

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use base64::Engine as _;

/// Nom du fichier écrit dans le dossier de données local de l'app.
const BUNDLE_NAME: &str = "mpv-cacerts.pem";

/// Le certificat est-il lisible comme autorité de confiance ?
fn is_usable(der: &[u8]) -> bool {
    let der = rustls_pki_types::CertificateDer::from(der);
    webpki::anchor_from_trusted_cert(&der).is_ok()
}

/// Un certificat DER en bloc PEM (lignes de 64 caractères, comme OpenSSL).
fn pem_block(der: &[u8]) -> String {
    let encoded = base64::engine::general_purpose::STANDARD.encode(der);
    let mut pem = String::with_capacity(encoded.len() + encoded.len() / 64 + 64);
    pem.push_str("-----BEGIN CERTIFICATE-----\n");
    for line in encoded.as_bytes().chunks(64) {
        // Base64 : uniquement de l'ASCII
        pem.push_str(std::str::from_utf8(line).unwrap_or_default());
        pem.push('\n');
    }
    pem.push_str("-----END CERTIFICATE-----\n");
    pem
}

/// Fichier PEM des certificats lisibles, sans doublon, dans l'ordre reçu ; `None` s'il n'en
/// reste aucun. Renvoie aussi le nombre de certificats gardés.
pub fn pem_bundle<'a>(certs: impl IntoIterator<Item = &'a [u8]>) -> Option<(String, usize)> {
    let mut seen = HashSet::new();
    let mut bundle = String::new();
    let mut count = 0;
    for der in certs {
        if !seen.insert(der) || !is_usable(der) {
            continue;
        }
        bundle.push_str(&pem_block(der));
        count += 1;
    }
    (count > 0).then_some((bundle, count))
}

/// Écrit le fichier dans `dir` ; `None` si aucun certificat n'est utilisable ou si l'écriture
/// échoue. Écrit à côté (nom propre au processus : deux fenêtres de Nyx ne se mélangent pas) puis
/// renommé : une écriture interrompue ne laisse jamais un fichier tronqué.
pub fn write_bundle(dir: &Path, certs: &[Vec<u8>]) -> Option<PathBuf> {
    let Some((pem, count)) = pem_bundle(certs.iter().map(Vec::as_slice)) else {
        log::warn!("[mpv] system CA bundle: no usable certificate");
        return None;
    };
    let file = dir.join(BUNDLE_NAME);
    let partial = dir.join(format!("{BUNDLE_NAME}.{}.tmp", std::process::id()));
    let written = std::fs::create_dir_all(dir)
        .and_then(|_| std::fs::write(&partial, pem))
        .and_then(|_| std::fs::rename(&partial, &file));
    match written {
        Ok(()) => {
            log::info!("[mpv] system CA bundle exported: {count} certificates");
            Some(file)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&partial);
            log::warn!("[mpv] system CA bundle export failed ({:?})", e.kind());
            None
        }
    }
}

/// Fichier d'un lancement précédent, gardé si l'export échoue (antivirus qui bloque le fichier…) :
/// des autorités de la veille valent mieux qu'aucun flux HTTPS.
pub fn previous_bundle(dir: &Path) -> Option<PathBuf> {
    let file = dir.join(BUNDLE_NAME);
    let usable = std::fs::read_to_string(&file)
        .is_ok_and(|pem| pem.contains("-----BEGIN CERTIFICATE-----") && pem.trim_end().ends_with("-----END CERTIFICATE-----"));
    usable.then_some(file)
}

/// Périphérique vide : fichier d'autorités sans aucune autorité (export impossible).
#[cfg(windows)]
const NO_AUTHORITY: &str = "NUL";
#[cfg(not(windows))]
const NO_AUTHORITY: &str = "/dev/null";

/// Options TLS ajoutées par Rust après toutes les autres (mpv garde la dernière valeur) : la
/// vérification est toujours active, toujours avec un fichier d'autorités (le périphérique vide
/// sans export). Un chemin non représentable en UTF-8 compte comme absent (mpv ne le lirait pas).
pub fn tls_args(bundle: Option<&Path>) -> Vec<String> {
    let ca_file = bundle.and_then(Path::to_str).unwrap_or(NO_AUTHORITY);
    vec!["--tls-verify=yes".to_string(), format!("--tls-ca-file={ca_file}")]
}

/// Fichier exporté pendant ce lancement de l'app ; vide tant que l'export n'a pas réussi.
#[cfg(desktop)]
static BUNDLE: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

/// Le dernier lancement de mpv.exe a-t-il reçu des autorités ? Vrai avant le premier lancement.
#[cfg(desktop)]
static TLS_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// Exporte les autorités du système au premier lancement de mpv (retenté tant qu'il échoue), puis
/// renvoie le même fichier.
#[cfg(desktop)]
pub fn ensure_bundle<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    let mut cached = BUNDLE.lock().unwrap_or_else(|e| e.into_inner());
    if cached.is_some() {
        return cached.clone();
    }
    let bundle = match app.path().app_local_data_dir() {
        Ok(dir) => {
            // Windows : magasins « Racine » de l'utilisateur et de la machine (crate schannel)
            let loaded = rustls_native_certs::load_native_certs();
            if !loaded.errors.is_empty() {
                log::warn!("[mpv] system CA store: {} read errors", loaded.errors.len());
            }
            let certs: Vec<Vec<u8>> = loaded.certs.iter().map(|c| c.as_ref().to_vec()).collect();
            let exported = write_bundle(&dir, &certs);
            *cached = exported.clone();
            exported.or_else(|| previous_bundle(&dir))
        }
        Err(e) => {
            log::warn!("[mpv] system CA bundle: no data folder ({e})");
            None
        }
    };
    if bundle.is_none() {
        log::warn!("[mpv] no CA bundle: HTTPS streams refused until the next player launch");
    }
    TLS_READY.store(bundle.is_some(), Ordering::Relaxed);
    bundle
}

/// Les flux HTTPS peuvent-ils être vérifiés ? Faux si mpv.exe a été lancé sans autorités : le web
/// affiche alors « Connexion sécurisée impossible à vérifier » au lieu d'un échec générique.
#[cfg(desktop)]
#[tauri::command]
pub fn nyx_mpv_tls_ready() -> bool {
    TLS_READY.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(mobile)]
#[tauri::command]
pub fn nyx_mpv_tls_ready() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une vraie autorité du système de la machine de test (Linux : /etc/ssl), lue comme sous
    /// Windows par rustls-native-certs.
    fn system_roots() -> Vec<Vec<u8>> {
        rustls_native_certs::load_native_certs()
            .certs
            .iter()
            .map(|c| c.as_ref().to_vec())
            .collect()
    }

    fn decode_pem(pem: &str) -> Vec<Vec<u8>> {
        pem.split("-----BEGIN CERTIFICATE-----\n")
            .skip(1)
            .map(|block| {
                let body: String = block
                    .split("-----END CERTIFICATE-----")
                    .next()
                    .unwrap()
                    .lines()
                    .collect();
                base64::engine::general_purpose::STANDARD.decode(body).unwrap()
            })
            .collect()
    }

    #[test]
    fn sans_export_aucune_autorite_jamais_les_chemins_par_defaut_d_openssl() {
        // Sans `--tls-ca-file`, OpenSSL ferait confiance à SSL_CERT_FILE et à son dossier compilé
        assert_eq!(
            tls_args(None),
            vec!["--tls-verify=yes".to_string(), format!("--tls-ca-file={NO_AUTHORITY}")]
        );
    }

    #[test]
    fn fichier_precedent_garde_seulement_s_il_est_complet() {
        let dir = std::env::temp_dir().join(format!("nyx-mpv-tls-prec-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(previous_bundle(&dir).is_none());
        std::fs::write(dir.join(BUNDLE_NAME), "-----BEGIN CERTIFICATE-----\nAAAA").unwrap();
        assert!(previous_bundle(&dir).is_none(), "fichier tronqué");
        let roots = system_roots();
        let file = write_bundle(&dir, &roots).unwrap();
        assert_eq!(previous_bundle(&dir), Some(file));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fichier_passe_a_mpv_avec_la_verification() {
        let path = Path::new("C:/Users/Jean Dupont/AppData/Local/com.nyx/mpv-cacerts.pem");
        assert_eq!(
            tls_args(Some(path)),
            vec![
                "--tls-verify=yes".to_string(),
                "--tls-ca-file=C:/Users/Jean Dupont/AppData/Local/com.nyx/mpv-cacerts.pem".to_string(),
            ]
        );
    }

    #[test]
    fn certificats_illisibles_ecartes_sans_perdre_les_autres() {
        let roots = system_roots();
        assert!(!roots.is_empty(), "aucune autorité système sur la machine de test");
        let good = roots[0].clone();
        let garbage = vec![0x30, 0x03, 0x02, 0x01, 0x00];
        let (pem, count) =
            pem_bundle([good.as_slice(), garbage.as_slice(), good.as_slice()]).unwrap();
        // Doublon et certificat illisible écartés : OpenSSL refuserait tout le fichier
        assert_eq!(count, 1);
        assert_eq!(decode_pem(&pem), vec![good]);
    }

    #[test]
    fn aucun_certificat_utilisable_aucun_fichier() {
        assert!(pem_bundle([[0u8; 4].as_slice()]).is_none());
        let dir = std::env::temp_dir().join(format!("nyx-mpv-tls-vide-{}", std::process::id()));
        assert!(write_bundle(&dir, &[vec![1, 2, 3]]).is_none());
        assert!(!dir.join(BUNDLE_NAME).exists());
    }

    #[test]
    fn export_des_autorites_du_systeme() {
        let roots = system_roots();
        let dir = std::env::temp_dir().join(format!("nyx-mpv-tls-{}", std::process::id()));
        let file = write_bundle(&dir, &roots).expect("fichier exporté");
        let pem = std::fs::read_to_string(&file).unwrap();
        let decoded = decode_pem(&pem);
        assert!(!decoded.is_empty());
        // Chaque bloc relu est exactement un certificat du système, lignes de 64 caractères au plus
        assert!(decoded.iter().all(|der| roots.contains(der)));
        assert!(pem.lines().all(|l| l.len() <= 64 || l.starts_with("-----")));
        let leftovers = std::fs::read_dir(&dir).unwrap().filter(|e| {
            e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp")
        });
        assert_eq!(leftovers.count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
