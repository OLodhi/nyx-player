//! Windows self-update: the page only asks "is there an update?" and the app answers with its own
//! settings (no downgrade, proxy, headers or target chosen by the page), and an update is offered
//! only when the version announced by `latest.json` is the one the signature was made for.
//!
//! `latest.json` itself is not signed: only the installer is. Whoever could change that file could
//! announce "9.9.9" with an old, genuine installer and its genuine signature, and the app would
//! install that old version. The signing tool writes the installer file name, version included
//! (`Nyx Player_0.7.6_x64-setup.exe`), in the trusted comment of the signature, and the signature
//! check made before installing covers that comment: comparing the two closes the gap.

use base64::Engine as _;

/// Installer file name written in the trusted comment of a minisign signature (base64, as found in
/// `latest.json`).
fn signed_file_name(signature_b64: &str) -> Option<String> {
    let text = base64::engine::general_purpose::STANDARD.decode(signature_b64.trim()).ok()?;
    let text = String::from_utf8(text).ok()?;
    // Only the third line is the signed comment (minisign format: untrusted comment, signature,
    // trusted comment, global signature). The first line is free text the check never covers: a
    // forged "trusted comment: …" placed there must not be read.
    let comment = text.lines().nth(2)?.strip_prefix("trusted comment: ")?;
    comment.split('\t').find_map(|field| field.strip_prefix("file:")).map(str::to_string)
}

/// Start of the signed installer name, before the version (`Nyx Player_0.7.6_x64-setup.exe`).
const INSTALLER_PREFIX: &str = "Nyx Player_";

/// True when the signature was made for the installer of `version` (`Nyx Player_<version>_<arch>…`).
pub fn signature_is_for_version(signature_b64: &str, version: &str) -> bool {
    signed_file_name(signature_b64).is_some_and(|file| {
        file.strip_prefix(INSTALLER_PREFIX)
            .and_then(|rest| rest.strip_prefix(version))
            .is_some_and(|rest| rest.starts_with('_'))
    })
}

/// True when every signature of the release (one per platform in `latest.json`) was made for the
/// version it announces. The updater also requires that version to be newer than the installed one.
#[cfg(desktop)]
pub fn signed_for_announced_version(release: &tauri_plugin_updater::RemoteRelease) -> bool {
    use tauri_plugin_updater::RemoteReleaseInner;
    let version = release.version.to_string();
    let signatures: Vec<&String> = match &release.data {
        RemoteReleaseInner::Dynamic(platform) => vec![&platform.signature],
        RemoteReleaseInner::Static { platforms } => platforms.values().map(|p| &p.signature).collect(),
    };
    let signed = !signatures.is_empty() && signatures.iter().all(|s| signature_is_for_version(s, &version));
    if !signed {
        log::warn!("[Update] Version {} announced, but its signature is for another installer: ignored", version);
    }
    signed
}

/// Metadata of an available update, in the shape `@tauri-apps/plugin-updater` builds its `Update`
/// from (`new Update(metadata)`): download and install then go through the plugin as before.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Looks for an update with the app's own settings (`tauri.conf.json`, version rule above). Replaces
/// the plugin's `check`, whose options (downgrades allowed, proxy, headers, target) came from the page.
#[tauri::command]
pub async fn nyx_update_check<R: tauri::Runtime>(webview: tauri::Webview<R>) -> Result<Option<UpdateMetadata>, String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        use tauri_plugin_updater::UpdaterExt;
        let update = webview.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
        Ok(update.map(|update| UpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            // Not shown by the app
            date: None,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        }))
    }
    #[cfg(mobile)]
    {
        // Android updates go through the nyx-android plugin (APK)
        let _ = webview;
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Signature of the 0.7.6 Windows installer, as published in `latest.json` (public).
    const SIGNATURE_0_7_6: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSQU16ZkRPTlY0MjVhUnpuRW50UTQ1NGlqalk1VThuMGllOVZ3cEFsbnQyalNUN3FudUJEcmptS21YVzg1dkhMaGovNjUwTG5lR0FIa2JVakluQi9uMGZscjBzUnkvOEE0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzc1ODU2MTU2CWZpbGU6Tnl4IFBsYXllcl8wLjcuNl94NjQtc2V0dXAuZXhlCnVlazVVSWhQSXdrNDJ4OFgvUDBFcGF6TC9oekNzd25MRUtRQm5IMitDYnMwc0pTaStJcjlKN3dtN05wU0U4K2lYTFEveC9xdC90U29MQ1VJZURHR0FRPT0K";

    #[test]
    fn the_signed_file_name_is_read_from_the_trusted_comment() {
        assert_eq!(signed_file_name(SIGNATURE_0_7_6).as_deref(), Some("Nyx Player_0.7.6_x64-setup.exe"));
    }

    #[test]
    fn an_announced_version_must_be_the_signed_one() {
        assert!(signature_is_for_version(SIGNATURE_0_7_6, "0.7.6"));
        // An old genuine installer announced as a newer version
        assert!(!signature_is_for_version(SIGNATURE_0_7_6, "9.9.9"));
        assert!(!signature_is_for_version(SIGNATURE_0_7_6, "0.7"));
        assert!(!signature_is_for_version(SIGNATURE_0_7_6, "7.6"));
        assert!(!signature_is_for_version(SIGNATURE_0_7_6, "0.7.6_x64-setup.exe"));
        assert!(!signature_is_for_version(SIGNATURE_0_7_6, ""));
    }

    /// Since tauri-cli 2.11.5 the signing tool appends the version after the file name
    /// (`timestamp:…\tfile:Nyx Player_0.8.0_x64-setup.exe\tversion:0.8.0`). Signature made with
    /// `tauri signer sign --app-version 0.8.0` (CLI 2.11.5) and a throwaway key.
    #[test]
    fn a_signature_from_the_2_11_signing_tool_keeps_its_file_name() {
        const SIGNATURE_CLI_2_11: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTNFJFd0FCSHVOWnV0Vy9rVVdnVFYxVmk2azFQa094Tm9yUjJia1JKUzJnbnZEUG1xc1U3a0M4TkE1NzRYNk1MTkVieUJNeWNvWFFPckoxQW9IQlZETUdCU0VvK3NxOXdNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzMzM1MzA2CWZpbGU6Tnl4IFBsYXllcl8wLjguMF94NjQtc2V0dXAuZXhlCXZlcnNpb246MC44LjAKREhtTE9kS3BNcUxBVVhHNitwcHhJcnY3aWV5SXAwL3pzUTd2MmdMb3VwU0luY3A0LzhFL1dQUlI5bXhvUVprU0haV3ZsOFBRT01WaFREblRWay9lQ0E9PQo=";
        assert_eq!(signed_file_name(SIGNATURE_CLI_2_11).as_deref(), Some("Nyx Player_0.8.0_x64-setup.exe"));
        assert!(signature_is_for_version(SIGNATURE_CLI_2_11, "0.8.0"));
        assert!(!signature_is_for_version(SIGNATURE_CLI_2_11, "0.8.1"));
    }

    /// The verified signature reads its trusted comment on the third line only: a version written
    /// in the free first line must not be believed.
    #[test]
    fn a_forged_comment_on_the_untrusted_line_is_ignored() {
        let genuine = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(SIGNATURE_0_7_6).unwrap()).unwrap();
        let mut lines: Vec<&str> = genuine.lines().collect();
        lines[0] = "trusted comment: timestamp:0\tfile:Nyx Player_9.9.9_x64-setup.exe";
        let forged = base64::engine::general_purpose::STANDARD.encode(lines.join("\n"));
        assert!(!signature_is_for_version(&forged, "9.9.9"));
        assert!(signature_is_for_version(&forged, "0.7.6"));
    }

    /// The published `latest.json` passes the rule: a release whose signature does not carry its
    /// version would stop every update without any message.
    #[cfg(desktop)]
    #[test]
    fn the_published_manifest_is_signed_for_its_version() {
        let manifest: serde_json::Value = serde_json::from_str(include_str!("../../web/updates/latest.json")).unwrap();
        let version = manifest["version"].as_str().unwrap().trim_start_matches('v');
        let platforms = manifest["platforms"].as_object().unwrap();
        assert!(!platforms.is_empty());
        for (target, platform) in platforms {
            assert!(signature_is_for_version(platform["signature"].as_str().unwrap(), version), "{target}");
        }
    }

    #[test]
    fn an_unreadable_signature_is_never_accepted() {
        assert!(!signature_is_for_version("", "0.7.6"));
        assert!(!signature_is_for_version("not base64 !", "0.7.6"));
        let no_comment = base64::engine::general_purpose::STANDARD.encode("untrusted comment: x\nRWQ\n");
        assert!(!signature_is_for_version(&no_comment, "0.7.6"));
    }

    #[cfg(desktop)]
    #[test]
    fn a_release_is_kept_only_when_signed_for_its_version() {
        use tauri_plugin_updater::{ReleaseManifestPlatform, RemoteRelease, RemoteReleaseInner};
        let release = |version: &str| RemoteRelease {
            version: version.parse().unwrap(),
            notes: None,
            pub_date: None,
            data: RemoteReleaseInner::Static {
                platforms: [(
                    "windows-x86_64".to_string(),
                    ReleaseManifestPlatform {
                        url: "https://releases.example.com/setup.exe".parse().unwrap(),
                        signature: SIGNATURE_0_7_6.to_string(),
                    },
                )]
                .into(),
            },
        };
        assert!(signed_for_announced_version(&release("0.7.6")));
        assert!(!signed_for_announced_version(&release("9.9.9")));
    }
}
