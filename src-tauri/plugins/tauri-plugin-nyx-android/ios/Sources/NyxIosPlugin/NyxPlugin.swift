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

// The player's arguments: optional where Kotlin has a default (the same defaults apply below)
struct PlayArgs: Decodable {
    let url: String
    let start: Double?
    let userAgent: String?
}

struct PausedArgs: Decodable {
    let paused: Bool?
}

struct SeekArgs: Decodable {
    let position: Double?
    let relative: Bool?
}

struct VolumeArgs: Decodable {
    let volume: Double?
}

struct MutedArgs: Decodable {
    let muted: Bool?
}

struct SpeedArgs: Decodable {
    let speed: Double?
}

struct TrackArgs: Decodable {
    let type: String
    let id: Int?
}

struct ResizeArgs: Decodable {
    let mode: String
}

struct MarginsArgs: Decodable {
    let left: Double?
    let right: Double?
    let top: Double?
    let bottom: Double?
}

struct ScaleArgs: Decodable {
    let scale: Double?
}

struct PropertyArgs: Decodable {
    let name: String
}

class NyxPlugin: Plugin {
    private let secureStore = SecureStore()
    private let networkMonitor = NetworkMonitor()
    private var fullscreen: FullscreenController?
    private var engine: MpvEngine?
    private var lifecycleObservers: [NSObjectProtocol] = []
    /// The CA file for mpv's TLS, written once at load (CaBundle); read by the engine after `caReady`
    private let caReady = DispatchGroup()
    private var caFileURL: URL?

    override func load(webview: WKWebView) {
        networkMonitor.start()
        // Once: load(webview:) runs again for any other web view
        guard fullscreen == nil else { return }
        let chrome = TaoChrome(webView: webview)
        let controller = FullscreenController(chrome: chrome)
        fullscreen = controller
        // Portrait on iPhone outside the player, as on Android phones
        controller.applyEverydayLock()
        startPlayer(webView: webview)
        #if DEBUG
        SpikeS3Check.startIfRequested(webView: webview, fullscreen: controller, chrome: chrome)
        #endif
    }

    /// The engine is created here, libmpv only at the first play. The CA file is written in the
    /// background meanwhile; the engine waits for it (on its own queue) when it needs it.
    private func startPlayer(webView: WKWebView) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        caReady.enter()
        DispatchQueue.global(qos: .utility).async { [self] in
            caFileURL = CaBundle.prepare(cacheDirectory: caches)
            caReady.leave()
        }
        engine = MpvEngine(
            host: VideoHost(webView: webView),
            emit: { [weak self] event, payload in self?.trigger(event, data: payload) },
            caFile: { [weak self] in
                guard let self else { return nil }
                self.caReady.wait()
                // Retried at every play if the first write failed, as Android does
                if self.caFileURL == nil { self.caFileURL = CaBundle.prepare(cacheDirectory: caches) }
                return self.caFileURL
            })
        let center = NotificationCenter.default
        lifecycleObservers = [
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
                [weak self] _ in self?.engine?.appDidEnterBackground()
            },
            center.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) {
                [weak self] _ in self?.engine?.appWillEnterForeground()
            },
        ]
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

    // MARK: Exit reports (Android's ExitReports.kt; iOS keeps no record of why the app last closed)

    /// Called by the Back button before closing the app (androidExitReport.ts, Android only).
    /// Nothing to note on iOS: the app is never closed from the page.
    @objc public func noteExitRequested(_ invoke: Invoke) {
        invoke.resolve()
    }

    /// Read once at launch (androidExitReport.ts, Android only). iOS has no equivalent of Android's
    /// ApplicationExitInfo, so there is never a report: `{report: null}`, the "nothing to send" answer.
    @objc public func lastExitReport(_ invoke: Invoke) {
        invoke.resolve(["report": NSNull()] as JsonObject)
    }

    // MARK: Player (Kotlin's NyxAndroidPlugin: same checks, defaults, clamps and messages)

    /// Network streams only, and no header added by the page (PlayerInputPolicy). An https stream
    /// without a CA file still resolves: the `error` event carries TLS_CA_UNAVAILABLE.
    @objc public func play(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(PlayArgs.self) else {
            return invoke.reject("play: invalid arguments")
        }
        guard PlayerInputPolicy.isAllowedStreamUrl(args.url) else {
            return invoke.reject("stream URL not allowed")
        }
        guard PlayerInputPolicy.isAllowedUserAgent(args.userAgent) else {
            return invoke.reject("user agent not allowed")
        }
        guard let engine else { return invoke.reject("WebView not attached yet") }
        engine.play(url: args.url, start: args.start ?? 0, userAgent: args.userAgent) { created in
            if created {
                invoke.resolve()
            } else {
                invoke.reject("libmpv could not be created")
            }
        }
    }

    /// Always leaves fullscreen and emits `fullscreen=false`, even with nothing playing (as on Android)
    @objc public func stop(_ invoke: Invoke) {
        engine?.stop()
        DispatchQueue.main.async { [self] in
            applyFullscreen(false)
            invoke.resolve()
        }
    }

    @objc public func setPaused(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(PausedArgs.self) else {
            return invoke.reject("set_paused: invalid arguments")
        }
        engine?.setPaused(args.paused ?? false)
        invoke.resolve()
    }

    @objc public func seek(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(SeekArgs.self) else {
            return invoke.reject("seek: invalid arguments")
        }
        engine?.seek(position: args.position ?? 0, relative: args.relative ?? false)
        invoke.resolve()
    }

    @objc public func setVolume(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(VolumeArgs.self) else {
            return invoke.reject("set_volume: invalid arguments")
        }
        engine?.setDouble("volume", PlayerSettings.volume(args.volume ?? 100))
        invoke.resolve()
    }

    @objc public func setMuted(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(MutedArgs.self) else {
            return invoke.reject("set_muted: invalid arguments")
        }
        engine?.setFlag("mute", args.muted ?? false)
        invoke.resolve()
    }

    @objc public func setSpeed(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(SpeedArgs.self) else {
            return invoke.reject("set_speed: invalid arguments")
        }
        engine?.setDouble("speed", PlayerSettings.speed(args.speed ?? 1))
        invoke.resolve()
    }

    /// audio → aid, anything else → sid; a negative id → auto, 0 → none
    @objc public func selectTrack(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(TrackArgs.self) else {
            return invoke.reject("select_track: invalid arguments")
        }
        engine?.setString(PlayerSettings.trackProperty(args.type), PlayerSettings.trackValue(args.id ?? 0))
        invoke.resolve()
    }

    @objc public func setResizeMode(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(ResizeArgs.self) else {
            return invoke.reject("set_resize_mode: invalid arguments")
        }
        let resize = PlayerSettings.resize(args.mode)
        engine?.setString("keepaspect", resize.keepAspect)
        engine?.setDouble("panscan", resize.panscan)
        invoke.resolve()
    }

    @objc public func setVideoMargins(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(MarginsArgs.self) else {
            return invoke.reject("set_video_margins: invalid arguments")
        }
        engine?.setDouble("video-margin-ratio-left", args.left ?? 0)
        engine?.setDouble("video-margin-ratio-right", args.right ?? 0)
        engine?.setDouble("video-margin-ratio-top", args.top ?? 0)
        engine?.setDouble("video-margin-ratio-bottom", args.bottom ?? 0)
        invoke.resolve()
    }

    @objc public func setSubtitleScale(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(ScaleArgs.self) else {
            return invoke.reject("set_subtitle_scale: invalid arguments")
        }
        engine?.setDouble("sub-scale", PlayerSettings.subtitleScale(args.scale ?? 1))
        invoke.resolve()
    }

    /// The player interface's properties only (a closed list, checked before anything else).
    /// `{value}`, null when unknown; `engine` is null until the first play.
    @objc public func getProperty(_ invoke: Invoke) {
        guard let args = try? invoke.parseArgs(PropertyArgs.self) else {
            return invoke.reject("get_property: invalid arguments")
        }
        guard PlayerInputPolicy.isReadableProperty(args.name) else {
            return invoke.reject("property not allowed")
        }
        switch args.name {
        case "fullscreen":
            DispatchQueue.main.async { [self] in
                invoke.resolve(["value": fullscreen?.isFullscreen ?? false] as JsonObject)
            }
        case "engine":
            if let id = engine?.id {
                invoke.resolve(["value": id] as JsonObject)
            } else {
                invoke.resolve(["value": NSNull()] as JsonObject)
            }
        default:
            guard let engine else { return invoke.resolve(["value": NSNull()] as JsonObject) }
            engine.getProperty(args.name) { value in
                invoke.resolve(["value": value] as JsonObject)
            }
        }
    }

    /// Landscape with the bars hidden on iPhone, then back. Always answers with the `fullscreen`
    /// property, changed or not: the page waits for it (as on Android).
    @objc public func setFullscreen(_ invoke: Invoke) {
        let enabled = (try? invoke.parseArgs(SetFullscreenArgs.self))?.enabled ?? false
        DispatchQueue.main.async { [self] in
            applyFullscreen(enabled)
            invoke.resolve()
        }
    }

    /// Main queue. Kotlin's applyFullscreen: always emits the property.
    private func applyFullscreen(_ enabled: Bool) {
        if enabled {
            fullscreen?.enter()
        } else {
            fullscreen?.exit()
        }
        trigger("property", data: ["name": "fullscreen", "data": enabled] as JSObject)
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
