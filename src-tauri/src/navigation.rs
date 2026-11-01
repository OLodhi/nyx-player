//! Navigation guard of the main window: only the app's own pages may load in it.
//!
//! The window injects the IPC bridge into any page loaded at the top level, and the app commands
//! (secrets, database, provider requests) are not limited to an origin. A link or a redirect towards
//! a remote site (on Android, a `target="_blank"` link opens in the same window) would give that site
//! the same access as the app. External links go through `openExternalLink` (system browser).

use tauri::Url;

/// How this system serves the embedded pages: `http://tauri.localhost` on Windows and Android,
/// `tauri://localhost` elsewhere (the app never asks for the https variant).
const SERVED_OVER_HTTP: bool = cfg!(any(windows, target_os = "android"));

/// True when `url` is a page of the app itself, as served on this system, or, in development only,
/// the dev server.
pub fn is_app_page(url: &Url, dev_url: Option<&Url>) -> bool {
    is_app_page_served(url, dev_url, SERVED_OVER_HTTP)
}

/// `is_app_page` for either way of serving the pages (both are tested on every system). Only the
/// address actually served is accepted: `https://tauri.localhost` reaches the device itself, where
/// another program could answer, and Tauri would still treat it as local.
fn is_app_page_served(url: &Url, dev_url: Option<&Url>, served_over_http: bool) -> bool {
    let embedded = if served_over_http {
        url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none()
    } else {
        url.scheme() == "tauri" && url.host_str() == Some("localhost")
    };
    embedded || dev_url.is_some_and(|dev| same_origin(url, dev))
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// Handler given to the main window: refused navigations are logged with their origin only (an
/// address may carry provider credentials).
pub fn guard(dev_url: Option<Url>) -> impl Fn(&Url) -> bool + Send + 'static {
    move |url| {
        let allowed = is_app_page(url, dev_url.as_ref());
        if !allowed {
            log::warn!("[Navigation] Refused in the app window: {}://{}", url.scheme(), url.host_str().unwrap_or(""));
        }
        allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn only_the_address_served_on_this_system_is_allowed() {
        // Windows and Android
        assert!(is_app_page_served(&url("http://tauri.localhost/"), None, true));
        assert!(is_app_page_served(&url("http://tauri.localhost/index.html#/films"), None, true));
        assert!(!is_app_page_served(&url("https://tauri.localhost/"), None, true));
        assert!(!is_app_page_served(&url("tauri://localhost/"), None, true));
        // Linux and macOS
        assert!(is_app_page_served(&url("tauri://localhost/"), None, false));
        assert!(is_app_page_served(&url("tauri://localhost/index.html#/films"), None, false));
        assert!(!is_app_page_served(&url("http://tauri.localhost/"), None, false));
        // This system
        let served = if SERVED_OVER_HTTP { "http://tauri.localhost/" } else { "tauri://localhost/" };
        assert!(is_app_page(&url(served), None));
    }

    #[test]
    fn remote_and_lookalike_pages_are_refused() {
        for page in [
            "https://www.youtube.com/watch?v=abc",
            "http://192.0.2.10:8080/player_api.php",
            "https://tauri.localhost.example.com/",
            "https://example.com/tauri.localhost",
            "http://tauri.localhost:8080/",
            "https://tauri.localhost/",
            "http://tauri.localhost.@example.com/",
            "tauri://evil/",
            "nyxposter://localhost/x.jpg",
            "http://nyxposter.example.com/",
            "file:///etc/passwd",
            "data:text/html,<p>x</p>",
            "javascript:alert(1)",
            "about:blank",
        ] {
            assert!(!is_app_page(&url(page), None), "{page}");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_given() {
        let dev = url("http://localhost:1420");
        assert!(is_app_page(&url("http://localhost:1420/index.html"), Some(&dev)));
        assert!(!is_app_page(&url("http://localhost:1420/"), None));
        assert!(!is_app_page(&url("http://localhost:1421/"), Some(&dev)));
        assert!(!is_app_page(&url("https://localhost:1420/"), Some(&dev)));
    }

    /// The page cannot send a form to another site either (a submit is a navigation the CSP decides).
    #[test]
    fn the_csp_forbids_form_submissions() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let csp = config["app"]["security"]["csp"].as_str().unwrap();
        assert!(csp.split(';').any(|d| d.trim() == "form-action 'none'"), "{csp}");
    }

    #[test]
    fn the_guard_refuses_what_is_not_an_app_page() {
        let guard = guard(None);
        assert!(guard(&url(if SERVED_OVER_HTTP { "http://tauri.localhost/" } else { "tauri://localhost/" })));
        assert!(!guard(&url("https://www.youtube.com/")));
    }
}

/// Every app command is declared in the app manifest (`build.rs`) and granted to the main window
/// (`capabilities/default.json`): a command missing from either is refused at run time.
#[cfg(test)]
mod acl_tests {
    use std::collections::BTreeSet;

    fn handler_commands() -> BTreeSet<String> {
        let lib = include_str!("lib.rs");
        let start = lib.find("generate_handler![").expect("generate_handler! in lib.rs");
        let block = &lib[start..start + lib[start..].find("])").unwrap()];
        block
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("//"))
            .filter_map(|line| line.strip_suffix(','))
            .filter_map(|path| path.rsplit_once("::").map(|(_, name)| name.to_string()))
            .collect()
    }

    #[test]
    fn every_command_is_declared_and_granted() {
        let commands = handler_commands();
        assert!(commands.len() > 30, "{commands:?}");

        let build = include_str!("../build.rs");
        let list = &build[build.find("APP_COMMANDS").unwrap()..];
        let list = &list[..list.find("];").unwrap()];
        let declared: BTreeSet<String> = list.split('"').skip(1).step_by(2).map(str::to_string).collect();
        assert_eq!(declared, commands, "build.rs APP_COMMANDS");

        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let granted: BTreeSet<String> = capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str()?.strip_prefix("allow-"))
            .filter(|p| !p.contains(':'))
            .map(|p| p.replace('-', "_"))
            .collect();
        assert_eq!(granted, commands, "capabilities/default.json allow-<command>");
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
    }

    /// The page only opens web links in the browser: the opener plugin gets that and nothing else
    /// (its default set would also let the page show any file in the file explorer).
    #[test]
    fn opener_only_opens_web_links() {
        let mut opener: Vec<String> = Vec::new();
        for file in [include_str!("../capabilities/default.json"), include_str!("../capabilities/desktop.json")] {
            let capability: serde_json::Value = serde_json::from_str(file).unwrap();
            opener.extend(
                capability["permissions"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|p| p.as_str())
                    .filter(|p| p.starts_with("opener:"))
                    .map(str::to_string),
            );
        }
        opener.sort();
        assert_eq!(opener, ["opener:allow-default-urls", "opener:allow-open-url"]);
    }
}

/// Calls through the real app ACL (generated context, simulated runtime): the app's own page may call
/// an app command, a remote page loaded in the same window may not.
#[cfg(test)]
mod ipc_tests {
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
    use tauri::webview::InvokeRequest;

    fn call_from(webview: &tauri::WebviewWindow<tauri::test::MockRuntime>, page: &str) -> Result<(), serde_json::Value> {
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: "cancel_epg_abort".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: page.parse().unwrap(),
                body: InvokeBody::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|_| ())
    }

    #[test]
    fn app_commands_answer_the_app_page_only() {
        let app = mock_builder()
            .invoke_handler(tauri::generate_handler![crate::epg_parser::cancel_epg_abort])
            // Same custom protocol as the app (poster thumbnails), so the spoofing case below is real
            .register_uri_scheme_protocol(crate::poster_thumbs::SCHEME, |_, _| {
                tauri::http::Response::builder().body(Vec::new()).unwrap()
            })
            .build(tauri::generate_context!())
            .unwrap();
        let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        // The app page address Tauri serves on this system (http://tauri.localhost on Windows and Android)
        let app_page = if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost/" } else { "tauri://localhost/" };
        assert_eq!(call_from(&main, app_page), Ok(()));
        assert!(call_from(&main, "https://www.youtube.com/watch?v=abc").is_err());
        // GHSA-7gmj-67g7-phm9 (tauri < 2.11.1): on Windows and Android, where a custom protocol is served
        // as http://<protocol>.localhost, a remote host starting with a registered protocol name passed for
        // local. That check is only compiled on those systems: on Linux and macOS this line is a plain
        // remote page, refused either way, so the case only proves the fix when the tests run on Windows.
        assert!(call_from(&main, &format!("http://{}.evil.com/", crate::poster_thumbs::SCHEME)).is_err());

        // Another window has no capability
        let other = tauri::WebviewWindowBuilder::new(&app, "other", Default::default()).build().unwrap();
        assert!(call_from(&other, app_page).is_err());
    }
}
