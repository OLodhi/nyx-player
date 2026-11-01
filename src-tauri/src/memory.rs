//! WebView2 memory management commands.
//! Controls the MemoryUsageTargetLevel COM interface to force renderer cache purges.

use std::sync::atomic::{AtomicBool, Ordering};

/// Flag global : true quand le player est actif (mode Low permanent).
/// Utilisé par trim_memory pour ne PAS remettre en Normal si le player
/// s'est activé pendant le cycle de 3s.
static PLAYER_MODE_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Vrai quand une purge temporaire peut remettre WebView2 en Normal, c'est-à-dire
/// quand le lecteur n'a pas demandé le mode Low permanent.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn should_restore_normal() -> bool {
    !PLAYER_MODE_ACTIVE.load(Ordering::SeqCst)
}

/// Purge le cache interne de WebView2 (disk cache, bitmaps décodés, etc.)
/// pour forcer la libération de la RAM retenue par le renderer Chromium.
/// Appelable depuis le frontend via invoke('purge_webview_cache'), par les outils de développement
/// seulement : absente des versions publiées, car elle efface aussi la session de l'utilisateur.
#[cfg(any(debug_assertions, feature = "audit"))]
#[tauri::command]
pub async fn purge_webview_cache(webview: tauri::WebviewWindow) -> Result<String, String> {
    webview
        .clear_all_browsing_data()
        .map_err(|e| format!("Failed to clear browsing data: {}", e))?;
    log::info!("[Memory] WebView2 browsing data purged");
    Ok("WebView2 cache purged successfully".to_string())
}

/// Force le renderer WebView2 à libérer ses bitmaps décodés et caches internes.
/// Bascule en MemoryUsageTargetLevel::Low pendant 3 secondes puis remet en Normal.
/// ⚠️ Si le player s'active pendant le cycle de 3s, la remise en Normal est annulée
/// pour ne pas casser le mode Low permanent du player.
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))] // WebView2 : Windows seulement
#[tauri::command]
pub async fn trim_memory(webview: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        };
        use windows::core::Interface;

        // Passer en mode Low via les COM interfaces
        let webview_clone = webview.clone();
        webview
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let level_low = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(1);
                        if unsafe { webview19.SetMemoryUsageTargetLevel(level_low) }.is_ok() {
                            log::info!("[Memory] MemoryUsageTargetLevel → Low");
                        }
                    }
                }
            })
            .map_err(|e| format!("Failed to access WebView2: {}", e))?;

        log::debug!("[Memory] Waiting 3s for renderer to purge...");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        // Vérifier si le player s'est activé pendant les 3s d'attente
        if !should_restore_normal() {
            log::info!("[Memory] trim_memory: player actif → on reste en Low (Normal annulé)");
            return Ok("trim_memory: Normal cancelled (player active)".to_string());
        }

        // Remettre en Normal (seulement si pas en mode player)
        webview_clone
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let level_normal = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(0);
                        if unsafe { webview19.SetMemoryUsageTargetLevel(level_normal) }.is_ok() {
                            log::info!("[Memory] MemoryUsageTargetLevel → Normal");
                        }
                    }
                }
            })
            .map_err(|e| format!("Failed to restore Normal: {}", e))?;

        log::info!("[Memory] Memory trim cycle complete");
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::warn!("[Memory] trim_memory is only supported on Windows (WebView2)");
    }

    Ok("Memory trim cycle complete (Low → 3s → Normal)".to_string())
}

/// Switch WebView2 en mode Low (purge agressive permanente)
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))] // WebView2 : Windows seulement
#[tauri::command]
pub async fn set_memory_low(webview: tauri::WebviewWindow) -> Result<String, String> {
    PLAYER_MODE_ACTIVE.store(true, Ordering::SeqCst);

    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        };
        use windows::core::Interface;

        webview
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let _ = unsafe {
                            webview19.SetMemoryUsageTargetLevel(
                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(1),
                            )
                        };
                        log::info!("[Memory] Mode LOW activé (purge agressive permanente)");
                    }
                }
            })
            .map_err(|e| format!("Failed: {}", e))?;
    }
    Ok("MemoryUsageTargetLevel → Low".to_string())
}

/// Switch WebView2 en mode Normal (performance max, cache agressif)
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))] // WebView2 : Windows seulement
#[tauri::command]
pub async fn set_memory_normal(webview: tauri::WebviewWindow) -> Result<String, String> {
    PLAYER_MODE_ACTIVE.store(false, Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        };
        use windows::core::Interface;

        webview
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let _ = unsafe {
                            webview19.SetMemoryUsageTargetLevel(
                                COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(0),
                            )
                        };
                        log::info!("[Memory] Mode NORMAL activé (performance max)");
                    }
                }
            })
            .map_err(|e| format!("Failed: {}", e))?;
    }
    Ok("MemoryUsageTargetLevel → Normal".to_string())
}

/// Purge mémoire spéciale pour le mode Player (déjà en Low).
/// Fait un micro-cycle Normal → 200ms → Low pour forcer Chromium à
/// re-évaluer ses allocations sans quitter le mode Low permanent.
/// Utilisé lors du zapping TV (switchChannel) pour éviter l'accumulation RAM.
#[cfg_attr(not(target_os = "windows"), allow(unused_variables))] // WebView2 : Windows seulement
#[tauri::command]
pub async fn trim_memory_in_player(webview: tauri::WebviewWindow) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        };
        use windows::core::Interface;

        // 1. Passer brièvement en Normal
        let webview_clone = webview.clone();
        webview
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let level_normal = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(0);
                        let _ = unsafe { webview19.SetMemoryUsageTargetLevel(level_normal) };
                        log::debug!("[Memory] In-player purge: Normal (brief)");
                    }
                }
            })
            .map_err(|e| format!("Failed to access WebView2: {}", e))?;

        // 2. Attendre 200ms — suffisant pour que Chromium enregistre la transition
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // 3. Revenir en Low — force Chromium à re-purger ses caches. Sauf si la lecture s'est arrêtée
        // pendant les 200 ms (set_memory_normal) : repasser en Low laisserait l'interface en mode
        // mémoire réduite jusqu'à la lecture suivante
        if should_restore_normal() {
            log::info!("[Memory] In-player purge: lecture arrêtée entre-temps → on reste en Normal");
            return Ok("In-player purge: Low cancelled (player stopped)".to_string());
        }
        webview_clone
            .with_webview(move |platform_webview| {
                let controller = platform_webview.controller();
                if let Ok(core_webview) = unsafe { controller.CoreWebView2() } {
                    if let Ok(webview19) = core_webview.cast::<ICoreWebView2_19>() {
                        let level_low = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(1);
                        let _ = unsafe { webview19.SetMemoryUsageTargetLevel(level_low) };
                        log::debug!("[Memory] In-player purge: Low (restored)");
                    }
                }
            })
            .map_err(|e| format!("Failed to restore Low: {}", e))?;

        log::info!("[Memory] In-player purge cycle complete (Normal → 200ms → Low)");
    }

    #[cfg(not(target_os = "windows"))]
    {
        log::warn!("[Memory] trim_memory_in_player is only supported on Windows (WebView2)");
    }

    Ok("In-player purge cycle complete (Normal → 200ms → Low)".to_string())
}

/// Setup auto-purge memory fallback loop for WebView2.
/// Called from lib.rs setup closure.
/// Toggles Low → 2s → Normal every 60s as a safety net.
#[cfg(target_os = "windows")]
pub fn setup_auto_purge(app: &tauri::App) {
    use tauri::Manager;

    /// Helper: set WebView2 MemoryUsageTargetLevel via COM interface.
    /// level: 0 = Normal, 1 = Low.
    fn set_memory_level(webview: &tauri::WebviewWindow, level: i32) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL,
        };
        use windows::core::Interface;

        let wv = webview.clone();
        let _ = wv.with_webview(move |platform_webview| {
            let controller = platform_webview.controller();
            if let Ok(core_wv) = unsafe { controller.CoreWebView2() } {
                if let Ok(wv19) = core_wv.cast::<ICoreWebView2_19>() {
                    let _ = unsafe {
                        wv19.SetMemoryUsageTargetLevel(
                            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL(level),
                        )
                    };
                }
            }
        });
    }

    if let Some(webview) = app.webview_windows().values().next().cloned() {
        tauri::async_runtime::spawn(async move {
            log::info!("[Memory] Auto-purge fallback started (every 60s)");
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                set_memory_level(&webview, 1); // Low
                log::debug!("[Memory] Auto-purge: Low (purging...)");

                tokio::time::sleep(std::time::Duration::from_secs(2)).await;

                // Le lecteur a demandé le mode Low permanent (set_memory_low) : ne pas
                // l'annuler en repassant en Normal.
                if !should_restore_normal() {
                    log::debug!("[Memory] Auto-purge: player actif → on reste en Low");
                    continue;
                }
                set_memory_level(&webview, 0); // Normal
                log::debug!("[Memory] Auto-purge: Normal (done)");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_is_restored_only_outside_player_mode() {
        PLAYER_MODE_ACTIVE.store(false, Ordering::SeqCst);
        assert!(should_restore_normal());
        PLAYER_MODE_ACTIVE.store(true, Ordering::SeqCst);
        assert!(!should_restore_normal());
        PLAYER_MODE_ACTIVE.store(false, Ordering::SeqCst);
    }
}
