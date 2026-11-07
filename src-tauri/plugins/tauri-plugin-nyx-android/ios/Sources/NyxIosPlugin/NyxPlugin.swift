// iOS side of the nyx-android plugin: same JS name and command names as the Kotlin plugin
// (android/), so the shared JavaScript calls `plugin:nyx-android|…` unchanged.
// Commands are the camelCase form of the snake_case names in build.rs.
import NyxPolicies
import Tauri
import UIKit
import WebKit

// Argument types: same field names as the Kotlin @InvokeArg classes (keys are not converted).
struct SecureKeyArgs: Decodable {
    let key: String
}

struct SecureSetArgs: Decodable {
    let key: String
    let value: String
}

struct SetFullscreenArgs: Decodable {
    let enabled: Bool?
}

class NyxPlugin: Plugin {
    private let secureStore = SecureStore()
    private let networkMonitor = NetworkMonitor()
    private var fullscreen: FullscreenController?

    override func load(webview: WKWebView) {
        networkMonitor.start()
        // Once: load(webview:) runs again for any other web view
        guard fullscreen == nil else { return }
        let chrome = TaoChrome(webView: webview)
        let controller = FullscreenController(chrome: chrome)
        fullscreen = controller
        // Portrait on iPhone outside the player, as on Android phones
        controller.applyEverydayLock()
        #if DEBUG
        SpikeS3Check.startIfRequested(webView: webview, fullscreen: controller, chrome: chrome)
        #endif
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

    /// `{connected, metered, type}`, type = wifi, cellular, ethernet, other or none. Rejected while
    /// the monitor has no reading: JS then assumes connected and unmetered (plugin contract).
    @objc public func networkStatus(_ invoke: Invoke) {
        networkMonitor.status { status in
            guard let status else {
                return invoke.reject("network_status: no network reading yet")
            }
            invoke.resolve([
                "connected": status.connected,
                "metered": status.metered,
                "type": status.type,
            ] as JsonObject)
        }
    }

    // MARK: Player

    /// Landscape with the bars hidden on iPhone, then back. Always answers with the `fullscreen`
    /// property, changed or not: the page waits for it (as on Android).
    @objc public func setFullscreen(_ invoke: Invoke) {
        let enabled = (try? invoke.parseArgs(SetFullscreenArgs.self))?.enabled ?? false
        DispatchQueue.main.async { [self] in
            if enabled {
                fullscreen?.enter()
            } else {
                fullscreen?.exit()
            }
            trigger("property", data: ["name": "fullscreen", "data": enabled] as JSObject)
            invoke.resolve()
        }
    }

    // MARK: Secure store (Keychain): credentials and the Supabase session

    /// `{value: null}` = really absent; a reject = temporarily unavailable (JS retries).
    @objc public func secureGet(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(SecureKeyArgs.self) else {
            return invoke.reject("secure_get: invalid arguments")
        }
        switch secureStore.get(args.key) {
        case .success(let value?):
            invoke.resolve(["value": value] as JsonObject)
        case .success(nil):
            invoke.resolve(["value": NSNull()] as JsonObject)
        case .failure(let error):
            invoke.reject(error.message)
        }
    }

    /// Resolves only once the Keychain holds the value.
    @objc public func secureSet(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(SecureSetArgs.self) else {
            return invoke.reject("secure_set: invalid arguments")
        }
        switch secureStore.set(args.key, args.value) {
        case .success:
            invoke.resolve()
        case .failure(let error):
            invoke.reject(error.message)
        }
    }

    @objc public func secureDelete(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(SecureKeyArgs.self) else {
            return invoke.reject("secure_delete: invalid arguments")
        }
        switch secureStore.delete(args.key) {
        case .success:
            invoke.resolve()
        case .failure(let error):
            invoke.reject(error.message)
        }
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
