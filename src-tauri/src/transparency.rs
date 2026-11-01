//! WebView2 background color management.
//!
//! With `transparent: true` in tauri.conf.json, WebView2 starts with a fully
//! transparent canvas (DefaultBackgroundColor = alpha:0). This is required for
//! MPV player overlay, but causes a visible transparent flash at startup.
//!
//! This module toggles DefaultBackgroundColor between opaque (#020a19 = --nyx-dark)
//! and transparent via the WebView2 COM API (ICoreWebView2Controller2).

/// Set WebView2 canvas to opaque #020a19 (--nyx-dark).
/// Called at startup and when exiting player mode.
#[tauri::command]
pub async fn set_webview_opaque(webview: tauri::WebviewWindow) -> Result<String, String> {
    apply_bg(webview, true)
}

/// Set WebView2 canvas to transparent.
/// Called when entering player mode (MPV overlay).
#[tauri::command]
pub async fn set_webview_transparent(webview: tauri::WebviewWindow) -> Result<String, String> {
    apply_bg(webview, false)
}

fn apply_bg(webview: tauri::WebviewWindow, opaque: bool) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
        };

        let label = if opaque { "OPAQUE" } else { "TRANSPARENT" };
        webview
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
                    let color: COREWEBVIEW2_COLOR = if opaque {
                        COREWEBVIEW2_COLOR { A: 255, R: 2, G: 10, B: 25 }
                    } else {
                        COREWEBVIEW2_COLOR { A: 0, R: 0, G: 0, B: 0 }
                    };
                    unsafe {
                        let _ = controller2.SetDefaultBackgroundColor(color);
                    }
                    log::info!("[Transparency] WebView2 → {}", label);
                }
            })
            .map_err(|e| format!("Failed to set {} bg: {}", label, e))?;
    }

    #[cfg(not(target_os = "windows"))]
    let _ = (webview, opaque);

    Ok(if opaque { "opaque" } else { "transparent" }.to_string())
}

/// Called during Tauri setup to force opaque background before the first frame.
pub fn init_opaque_background(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        use windows::core::Interface;
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, COREWEBVIEW2_COLOR,
        };

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
                    let color: COREWEBVIEW2_COLOR = COREWEBVIEW2_COLOR {
                        A: 255, R: 2, G: 10, B: 25,
                    };
                    unsafe {
                        let _ = controller2.SetDefaultBackgroundColor(color);
                    }
                    log::info!("[Transparency] Startup: opaque background applied");
                }
            });
        } else {
            log::warn!("[Transparency] Main window not found during setup");
        }
    }

    #[cfg(not(target_os = "windows"))]
    let _ = app;
}
