// iOS side of the nyx-android plugin: same JS name and command names as the Kotlin plugin
// (android/), so the shared JavaScript calls `plugin:nyx-android|…` unchanged.
// Commands are the camelCase form of the snake_case names in build.rs.
import Libmpv
import Tauri
import UIKit
import WebKit

class NyxPlugin: Plugin {
    // MARK: SPIKE S1 (never merged): prove libmpv links and starts

    override func load(webview: WKWebView) {
        #if DEBUG
        mpvSmokeTest()
        #endif
    }

    private func mpvSmokeTest() {
        let version = mpv_client_api_version()
        NSLog("[nyx-s1] mpv client API %lu.%lu", version >> 16, version & 0xffff)
        guard let handle = mpv_create() else {
            NSLog("[nyx-s1] mpv_create returned nil")
            return
        }
        let status = mpv_initialize(handle)
        NSLog("[nyx-s1] mpv_initialize -> %d", status)
        mpv_terminate_destroy(handle)
        NSLog("[nyx-s1] mpv_terminate_destroy done")
    }

    // MARK: Device

    /// Read only by the Android TV detection (platform.ts): an iPhone or iPad is never a TV.
    @objc public func deviceInfo(_ invoke: Invoke) {
        let bounds = UIScreen.main.bounds
        invoke.resolve([
            "isTv": false,
            "hasTouchscreen": true,
            "smallestWidthDp": Int(min(bounds.width, bounds.height)),
        ])
    }

    // MARK: App updates (Android APK only; iOS updates come from the sideloading tool)

    @objc public func updateInfo(_ invoke: Invoke) { invoke.reject("not supported on iOS") }

    @objc public func fetchUpdateManifest(_ invoke: Invoke) { invoke.reject("not supported on iOS") }

    @objc public func requestInstallPermission(_ invoke: Invoke) { invoke.reject("not supported on iOS") }

    @objc public func downloadUpdate(_ invoke: Invoke) { invoke.reject("not supported on iOS") }

    @objc public func installUpdate(_ invoke: Invoke) { invoke.reject("not supported on iOS") }
}

// Must be public: release builds fail to link otherwise (Tauri issue #16130, Xcode 27).
@_cdecl("init_plugin_nyx_android")
public func initPlugin() -> Plugin { NyxPlugin() }
