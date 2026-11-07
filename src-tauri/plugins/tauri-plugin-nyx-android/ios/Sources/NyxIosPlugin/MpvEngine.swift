import Foundation
import Libmpv
import NyxMpvLinks
import NyxPolicies
import Tauri
import UIKit

/// libmpv (the desktop player's engine, FFmpeg based) drawing into the video view below the
/// transparent page, through MoltenVK. A port of Android's MpvEngine.kt: same options, events,
/// error codes and log rules. The iOS differences: the Metal layer instead of a SurfaceView,
/// VideoToolbox, and the CA file GnuTLS needs (CaBundle).
///
/// Threads: every libmpv call runs on `queue`, a serial queue that also owns all of the engine's
/// state. Only `mpv_wait_event` runs elsewhere, on the event thread, which copies each event and
/// hands it to `queue`. UIKit work goes to the main queue asynchronously, and the main queue never
/// waits on libmpv, except in `appDidEnterBackground`: the stream must be closed before iOS takes
/// the GPU away. That wait is safe because `queue` never waits on the main queue.
final class MpvEngine {
    /// Same User-Agent as the desktop mpv and Android (providers reject unknown clients)
    private static let defaultUserAgent =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    private static let logCategory = "NyxPlayerDiag"
    private static let timePosIntervalMs: Int64 = 250
    /// Time left for log messages delivered after END_FILE (observed on Android: a few ms)
    private static let lateLogGraceMs = 500
    private static let resizeQuietMs = 250
    private static let mib: Int64 = 1024 * 1024
    /// Info-level mpv messages worth keeping: track list, decoder choice, demuxer
    private static let infoPrefixes: Set<String> = ["cplayer", "vd", "ad", "demux"]
    private static let warnLevel = Int(MPV_LOG_LEVEL_WARN.rawValue)
    private static let infoLevel = Int(MPV_LOG_LEVEL_INFO.rawValue)

    /// Android's OBSERVED list, same formats
    private static let observed: [(String, mpv_format)] = [
        ("time-pos", MPV_FORMAT_DOUBLE),
        ("duration", MPV_FORMAT_DOUBLE),
        ("pause", MPV_FORMAT_FLAG),
        ("paused-for-cache", MPV_FORMAT_FLAG),
        ("seeking", MPV_FORMAT_FLAG),
        ("core-idle", MPV_FORMAT_FLAG),
        ("eof-reached", MPV_FORMAT_FLAG),
        ("volume", MPV_FORMAT_DOUBLE),
        ("mute", MPV_FORMAT_FLAG),
        ("speed", MPV_FORMAT_DOUBLE),
        ("sub-scale", MPV_FORMAT_DOUBLE),
        ("aid", MPV_FORMAT_STRING),
        ("sid", MPV_FORMAT_STRING),
        ("track-list", MPV_FORMAT_NONE),
    ]

    private struct LoadRequest {
        let url: String
        let start: Double
        var paused: Bool
    }

    /// An mpv event copied off the event thread (its memory is only valid until the next wait)
    private enum Event {
        case property(name: String, value: PropertyChange)
        case log(prefix: String, level: Int, line: String)
        case startFile
        case fileLoaded
        case videoReconfig
        case endFile
    }

    private enum PropertyChange {
        /// No value: track-list's change signal, or a property that became unavailable
        case unset
        case flag(Bool)
        case double(Double)
        case string(String)
    }

    private let host: VideoHost
    private let emit: (String, JSObject) -> Void
    private let caFile: () -> URL?
    private let queue = DispatchQueue(label: "com.nyxplayer.mpv", qos: .userInitiated)

    private let playedLock = NSLock()
    private var played = false

    // Main queue only
    private var lastVideoSize = CGSize.zero

    // `queue` only, from here on
    private var handle: OpaquePointer?
    /// mpv has the layer (`wid`); before that, a load waits in pendingLoad (Android: surfaceReady)
    private var layerReady = false
    private var layerRequested = false
    /// The CA file given to mpv (nil until CaBundle has written it)
    private var caPath: String?

    private var pendingLoad: LoadRequest?
    private var currentUrl: String?
    /// The last stream sent to mpv, and whether it finished opening (before: duration and position unknown)
    private var lastLoad: LoadRequest?
    private var fileLoaded = false

    // Load failure detection: END_FILE after START_FILE without FILE_LOADED, plus an explicit failure log
    private var loading = false
    private var stopRequested = false
    private var openFailed = false
    private var lastHttpStatus: Int?
    /// The TLS layer (handshake, certificate) failed while opening
    private var tlsFailed = false
    private var decoderFailureReported = false
    /// Bumped by every load, stop, background close and release: a deferred failure check from an
    /// older load is dropped
    private var generation = 0

    private var lastTimePosEmit: Int64 = 0

    /// Between leaving the screen and coming back: no stream opens, requests wait for the return
    private var inBackground = false
    /// What reopens on return (the stream closed for the background, or a play asked meanwhile)
    private var backgroundResume: LoadRequest?

    private let logRepeats = LogRepeatFilter()
    private let resizeDebouncer = ResizeDebouncer(quietMs: Int64(MpvEngine.resizeQuietMs))
    // track-list and VIDEO_RECONFIG fire repeatedly (HLS variants, resizes): log changes only
    private var lastTracksLog = ""
    private var lastDecodingLog = ""

    /// `emit` is the plugin's trigger (called on the main queue). `caFile` is called on the engine's
    /// queue and may wait for CaBundle to finish writing.
    init(host: VideoHost, emit: @escaping (String, JSObject) -> Void, caFile: @escaping () -> URL?) {
        self.host = host
        self.emit = emit
        self.caFile = caFile
    }

    /// "libmpv" once a stream has been asked for, nil before (get_property("engine"), as on Android)
    var id: String? {
        playedLock.lock()
        defer { playedLock.unlock() }
        return played ? "libmpv" : nil
    }

    // MARK: Commands (any thread; run in call order on the engine's queue)

    /// The plugin has validated the URL and the user agent. `done(false)`: libmpv couldn't be created.
    func play(url: String, start: Double, userAgent: String?, done: @escaping (Bool) -> Void) {
        queue.async { [self] in
            guard ensureMpv(userAgent: userAgent ?? Self.defaultUserAgent) else { return done(false) }
            markPlayed()
            // Retried for an http stream too: it can redirect to https
            let verifiable = ensureCertificates()
            if PlaybackPolicy.isHttps(url) && !verifiable {
                refuseUnverifiedHttps(url)
                return done(true)
            }
            let request = LoadRequest(url: url, start: start, paused: false)
            if inBackground {
                // A retry or a channel change during the background: it opens on return
                backgroundResume = request
                logInfo("play \(StreamDiagnostics.describeUrl(url)) deferred until foreground")
                return done(true)
            }
            backgroundResume = nil
            logInfo("play \(StreamDiagnostics.describeUrl(url)) start=\(start)s")
            requestLoad(request)
            done(true)
        }
    }

    func stop() {
        queue.async { [self] in stopOnQueue() }
    }

    func setPaused(_ paused: Bool) {
        queue.async { [self] in
            if inBackground {
                backgroundResume?.paused = paused
                return
            }
            pendingLoad?.paused = paused
            mpvSetFlag("pause", paused)
        }
    }

    func seek(position: Double, relative: Bool) {
        queue.async { [self] in
            mpvCommand(["seek", "\(position)", relative ? "relative" : "absolute"])
        }
    }

    /// Plain property setters; the plugin applies PlayerSettings' clamps first
    func setDouble(_ name: String, _ value: Double) {
        queue.async { [self] in mpvSetDouble(name, value) }
    }

    func setFlag(_ name: String, _ value: Bool) {
        queue.async { [self] in mpvSetFlag(name, value) }
    }

    func setString(_ name: String, _ value: String) {
        queue.async { [self] in mpvSetString(name, value) }
    }

    /// The property as the page expects it (PropertyValue.convert), or null. The plugin has checked
    /// the name against PlayerInputPolicy. Answers on the engine's queue.
    func getProperty(_ name: String, completion: @escaping (JSValue) -> Void) {
        queue.async { [self] in
            completion(Self.jsValue(PropertyValue.convert(mpvGetString(name), name: name)))
        }
    }

    // MARK: App lifecycle (main queue, from the plugin's notification observers)

    /// Closes the stream and keeps where to reopen it (design §6.2, Android's onBackground). Waits
    /// for it, inside a background task, while iOS still allows GPU work: video left running in the
    /// background stays frozen for good after the return (MPVKit #4).
    func appDidEnterBackground() {
        let application = UIApplication.shared
        // No expiration handler needed: the task ends right after the close, which takes milliseconds
        let task = application.beginBackgroundTask(withName: "nyx-close-stream", expirationHandler: nil)
        queue.sync { closeForBackground() }
        if task != .invalid { application.endBackgroundTask(task) }
    }

    func appWillEnterForeground() {
        queue.async { [self] in
            guard inBackground else { return }
            inBackground = false
            guard let request = backgroundResume else { return }
            backgroundResume = nil
            requestLoad(request)
            logInfo("foreground: stream reopened (start=\(request.start)s)")
        }
    }

    func release() {
        queue.async { [self] in
            generation += 1
            stopRequested = true
            pendingLoad = nil
            currentUrl = nil
            backgroundResume = nil
            guard handle != nil else { return }
            // The event thread destroys the handle when mpv confirms the shutdown, as its last call:
            // destroying it here could race with its mpv_wait_event
            mpvCommand(["quit"])
            handle = nil
            layerReady = false
            layerRequested = false
            DispatchQueue.main.async { [host] in host.hideStream() }
            logInfo("released")
        }
    }

    // MARK: Loading (queue)

    private func markPlayed() {
        playedLock.lock()
        played = true
        playedLock.unlock()
    }

    private func requestLoad(_ request: LoadRequest) {
        generation += 1
        stopRequested = false
        openFailed = false
        lastHttpStatus = nil
        tlsFailed = false
        currentUrl = request.url
        showVideoLayer()
        if layerReady {
            load(request)
        } else {
            pendingLoad = request
        }
    }

    private func load(_ request: LoadRequest) {
        guard let mpv = handle else { return }
        mpvSetString("force-window", "yes")
        // `start` as an option (not loadfile's per-file options): same syntax on every mpv version
        mpvOption(mpv, "start", PlaybackPolicy.startOption(request.start))
        mpvSetFlag("pause", request.paused)
        lastLoad = request
        fileLoaded = false
        mpvCommand(["loadfile", request.url, "replace"])
    }

    /// Shows the video view, attaching it first (once) and then handing its layer to mpv.
    private func showVideoLayer() {
        let attach = !layerReady && !layerRequested
        if attach { layerRequested = true }
        DispatchQueue.main.async { [self] in
            if attach {
                guard let view = host.attachIfNeeded(), let pointer = host.layerPointer else {
                    queue.async { self.layerUnavailable() }
                    return
                }
                lastVideoSize = view.bounds.size
                view.onSizeChange = { [weak self, weak view] in
                    guard let self, let size = view?.bounds.size, size != self.lastVideoSize else { return }
                    self.lastVideoSize = size
                    self.videoSizeChanged()
                }
                queue.async { self.layerAttached(pointer) }
            }
            host.showStream()
        }
    }

    private func layerAttached(_ pointer: Int64) {
        guard let mpv = handle else { return }
        // The layer's address, not retained: VideoHost keeps the view, and the layer, alive
        var wid = pointer
        mpv_set_option(mpv, "wid", MPV_FORMAT_INT64, &wid)
        layerReady = true
        guard let request = pendingLoad else { return }
        pendingLoad = nil
        load(request)
    }

    /// The web view isn't in a view hierarchy yet: nothing can be shown, the page gets an error
    private func layerUnavailable() {
        layerRequested = false
        guard pendingLoad != nil else { return }
        pendingLoad = nil
        currentUrl = nil
        logWarning("no view to draw the video in: the web view has no superview")
        emitError(PlaybackPolicy.loadFailed)
    }

    /// Certificates for mpv's TLS. A missing CA file is retried at every play: verification stays
    /// on in every case. An http stream redirected to https fails too without them, with the same
    /// message (reportLoadFailure).
    private func ensureCertificates() -> Bool {
        if caPath != nil { return true }
        guard let mpv = handle, let path = caFile()?.path else { return false }
        mpv_set_option_string(mpv, "tls-ca-file", path)
        caPath = path
        return true
    }

    /// An https stream without certificates to check it: refused with a clear message instead of
    /// being played unverified. http streams aren't affected.
    private func refuseUnverifiedHttps(_ url: String) {
        stopOnQueue()
        logWarning("play \(StreamDiagnostics.describeUrl(url)) refused: CA list unavailable, HTTPS not verifiable")
        emitError(PlaybackPolicy.tlsCaUnavailable)
    }

    private func stopOnQueue() {
        generation += 1
        stopRequested = true
        pendingLoad = nil
        currentUrl = nil
        backgroundResume = nil
        if handle != nil {
            mpvCommand(["stop"])
            setVideoMargins(0, 0, 0, 0)
            // No window once stopped: mpv closes its video output, so nothing draws while hidden
            mpvSetString("force-window", "no")
        }
        // After the stop has returned: a hidden layer can stall mpv's video output
        DispatchQueue.main.async { [host] in host.hideStream() }
    }

    private func setVideoMargins(_ left: Double, _ right: Double, _ top: Double, _ bottom: Double) {
        mpvSetDouble("video-margin-ratio-left", left)
        mpvSetDouble("video-margin-ratio-right", right)
        mpvSetDouble("video-margin-ratio-top", top)
        mpvSetDouble("video-margin-ratio-bottom", bottom)
    }

    private func closeForBackground() {
        // A second notification without a return: already closed, resume point already kept
        if inBackground { return }
        inBackground = true
        let url = currentUrl
        // Layer not ready yet, or the stream not open yet (duration unknown): the request is kept as it is
        var candidate = pendingLoad ?? lastLoad.flatMap { !fileLoaded && $0.url == url ? $0 : nil }
        if candidate == nil, handle != nil, let url {
            let point = LifecyclePolicy.resumePoint(
                url: url,
                duration: mpvGetDouble("duration") ?? 0,
                timePos: mpvGetDouble("time-pos") ?? 0,
                paused: mpvGetFlag("pause") ?? false)
            candidate = LoadRequest(url: point.url, start: point.start, paused: point.paused)
        }
        guard let resume = candidate else { return }
        pendingLoad = nil
        backgroundResume = resume
        generation += 1
        stopRequested = true
        mpvCommand(["stop"])
        mpvSetString("force-window", "no")
        logInfo("background: stream closed (resume at \(resume.start)s)")
    }

    // MARK: Rotation and resize

    /// Main queue (VideoView's layout). MPVKit 1.0.0's MoltenVK context never reports a resize, so
    /// once the size has settled, a new video output picks it up (as Android does on surface changes).
    private func videoSizeChanged() {
        queue.async { [self] in
            resizeDebouncer.sizeChanged(nowMs: nowMs())
            queue.asyncAfter(deadline: .now() + .milliseconds(Self.resizeQuietMs + 10)) { [self] in
                guard resizeDebouncer.due(nowMs: nowMs()), handle != nil, currentUrl != nil else { return }
                mpvSetString("vo", "gpu-next")
            }
        }
    }

    // MARK: Creating libmpv (queue)

    private func ensureMpv(userAgent: String) -> Bool {
        if handle != nil { return true }
        guard let mpv = mpv_create() else {
            logWarning("libmpv could not be created")
            return false
        }
        // Before mpv_initialize, in this order: Android's configure, with MPVKit's Metal demo for the
        // video output. `wid` follows once the video view exists (layerAttached).
        mpvOption(mpv, "profile", "fast")
        mpvOption(mpv, "vo", "gpu-next")
        mpvOption(mpv, "gpu-api", "vulkan")
        mpvOption(mpv, "gpu-context", "moltenvk")
        #if targetEnvironment(simulator)
        // VideoToolbox to Metal is the part least likely to work in the Simulator
        mpvOption(mpv, "hwdec", "no")
        #else
        mpvOption(mpv, "hwdec", "videotoolbox")
        #endif
        mpvOption(mpv, "hwdec-codecs", "h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1")
        mpvOption(mpv, "ao", "avfoundation,audiounit")
        // Without it, ao_audiounit mixes with other apps' sound, which breaks Now Playing (MPVKit #71)
        mpvOption(mpv, "audio-exclusive", "yes")
        // Same network behaviour as the desktop player (mpvBridge.ts)
        mpvOption(mpv, "user-agent", userAgent)
        mpvOption(mpv, "network-timeout", "30")
        mpvOption(mpv, "stream-lavf-o", "multiple_requests=0")
        mpvOption(mpv, "cache", "yes")
        let memory = Int64(clamping: ProcessInfo.processInfo.physicalMemory)
        let cache = PlaybackPolicy.cacheSizes(totalMemoryBytes: memory, lowRamDevice: false)
        mpvOption(mpv, "demuxer-max-bytes", String(cache.forwardBytes))
        mpvOption(mpv, "demuxer-max-back-bytes", String(cache.backBytes))
        mpvOption(mpv, "keep-open", "yes")
        mpvOption(mpv, "ytdl", "no")
        // As on Windows (mpv_guard.rs): a remote playlist never leads to a local file
        mpvOption(mpv, "load-unsafe-playlists", "no")
        mpvOption(mpv, "input-default-bindings", "no")
        // Always verified (mpv's default is no). GnuTLS can't read the iOS trust store, so mpv gets
        // Mozilla's list (CaBundle); without it, https streams are refused at play.
        mpvOption(mpv, "tls-verify", "yes")
        if let path = caFile()?.path {
            mpvOption(mpv, "tls-ca-file", path)
            caPath = path
        } else {
            logWarning("CA list unavailable: HTTPS streams refused until it is written")
        }

        let status = mpv_initialize(mpv)
        guard status >= 0 else {
            logWarning("libmpv could not be initialised (\(status))")
            mpv_terminate_destroy(mpv)
            return false
        }

        mpvOption(mpv, "save-position-on-quit", "no")
        mpvOption(mpv, "force-window", "no")
        mpvOption(mpv, "idle", "yes")
        mpv_request_log_messages(mpv, "info")
        for (name, format) in Self.observed {
            mpv_observe_property(mpv, 0, name, format)
        }
        handle = mpv
        startEventThread(mpv)
        logInfo("libmpv created (hwdec=videotoolbox then software; demuxer cache "
            + "\(cache.forwardBytes / Self.mib)+\(cache.backBytes / Self.mib) MiB, RAM \(memory / Self.mib) MiB)")
        return true
    }

    // MARK: libmpv events

    /// The only caller of mpv_wait_event. Copies each event, then hands it to the queue.
    private func startEventThread(_ mpv: OpaquePointer) {
        let thread = Thread { [weak self] in
            while true {
                guard let pointer = mpv_wait_event(mpv, -1) else { continue }
                let event = pointer.pointee
                if event.event_id == MPV_EVENT_SHUTDOWN {
                    // This thread's last call on the handle: it can now be destroyed
                    if let self {
                        self.queue.async { mpv_terminate_destroy(mpv) }
                    } else {
                        mpv_terminate_destroy(mpv)
                    }
                    return
                }
                guard let copied = MpvEngine.copy(event), let self else { continue }
                self.queue.async { self.process(copied) }
            }
        }
        thread.name = "nyx-mpv-events"
        thread.qualityOfService = .userInitiated
        thread.start()
    }

    /// Event thread
    private static func copy(_ event: mpv_event) -> Event? {
        switch event.event_id {
        case MPV_EVENT_PROPERTY_CHANGE:
            guard let data = event.data else { return nil }
            let property = data.assumingMemoryBound(to: mpv_event_property.self).pointee
            let name = String(cString: property.name)
            guard let value = property.data else { return .property(name: name, value: .unset) }
            switch property.format {
            case MPV_FORMAT_FLAG:
                return .property(name: name, value: .flag(value.assumingMemoryBound(to: Int32.self).pointee != 0))
            case MPV_FORMAT_DOUBLE:
                return .property(name: name, value: .double(value.assumingMemoryBound(to: Double.self).pointee))
            case MPV_FORMAT_STRING:
                guard let chars = value.assumingMemoryBound(to: UnsafePointer<CChar>?.self).pointee else {
                    return .property(name: name, value: .unset)
                }
                return .property(name: name, value: .string(String(cString: chars)))
            default:
                return .property(name: name, value: .unset)
            }
        case MPV_EVENT_LOG_MESSAGE:
            guard let data = event.data else { return nil }
            let message = data.assumingMemoryBound(to: mpv_event_log_message.self).pointee
            return .log(
                prefix: String(cString: message.prefix),
                level: Int(message.log_level.rawValue),
                line: String(cString: message.text))
        case MPV_EVENT_START_FILE:
            return .startFile
        case MPV_EVENT_FILE_LOADED:
            return .fileLoaded
        case MPV_EVENT_VIDEO_RECONFIG:
            return .videoReconfig
        case MPV_EVENT_END_FILE:
            return .endFile
        default:
            return nil
        }
    }

    /// Queue
    private func process(_ event: Event) {
        switch event {
        case let .property(name, value):
            propertyChanged(name, value)
        case let .log(prefix, level, line):
            logMessage(prefix: prefix, level: level, raw: line)
        case .startFile:
            loading = true
            openFailed = false
            lastHttpStatus = nil
            tlsFailed = false
            decoderFailureReported = false
            lastTracksLog = ""
            lastDecodingLog = ""
        case .fileLoaded:
            loading = false
            fileLoaded = true
            logDecoding()
        case .videoReconfig:
            logDecoding()
        case .endFile:
            let wasLoading = loading && !stopRequested
            loading = false
            guard wasLoading else { return }
            // mpv delivers log messages through a separate buffer: "Failed to open" or "HTTP error"
            // can arrive just after END_FILE. Decide once they have had time to come in.
            let generation = self.generation
            queue.asyncAfter(deadline: .now() + .milliseconds(Self.lateLogGraceMs)) { [self] in
                reportLoadFailure(generation)
            }
        }
    }

    private func propertyChanged(_ name: String, _ value: PropertyChange) {
        switch value {
        case .unset:
            if name == "track-list" {
                logTracks()
                // Change signal only: the page reads the list with get_property (audio and subtitle
                // menus, preferred languages on live channels)
                emitProperty(name, NSNull())
            } else if name == "eof-reached" {
                // Unavailable while the next stream loads: forwarded as the desktop IPC does, or the
                // page keeps "end reached" from the previous stream (useLiveEndWatchdog)
                emitProperty(name, NSNull())
            }
        case let .double(number):
            if name == "time-pos" {
                let now = nowMs()
                if now - lastTimePosEmit < Self.timePosIntervalMs { return }
                lastTimePosEmit = now
            }
            emitProperty(name, number)
        case let .flag(flag):
            emitProperty(name, flag)
        case let .string(raw):
            emitProperty(name, Self.jsValue(PropertyValue.convert(raw, name: name)))
        }
    }

    /// Ignored if the page stopped or another load started meanwhile (START_FILE resets the flags)
    private func reportLoadFailure(_ generation: Int) {
        guard generation == self.generation, !stopRequested else { return }
        let code = PlaybackPolicy.loadFailureCode(tlsFailed: tlsFailed, certificatesAvailable: caPath != nil)
        // END_FILE with no failure in the log: not an error
        if !openFailed && lastHttpStatus == nil && code == PlaybackPolicy.loadFailed { return }
        // No certificates: a redirect's HTTP status doesn't explain the failure
        let status = code == PlaybackPolicy.loadFailed ? lastHttpStatus : nil
        // Nothing to reopen after the background: the error screen (spaced retries) decides
        currentUrl = nil
        let http = status.map { " http=\($0)" } ?? ""
        let tls = code == PlaybackPolicy.tlsCaUnavailable ? ": HTTPS not verifiable (CA list unavailable)" : ""
        logWarning("load failed\(http)\(tls)")
        emitError(code, httpStatus: status)
    }

    private func logMessage(prefix: String, level: Int, raw: String) {
        var line = raw
        while let last = line.last, last.isWhitespace { line.removeLast() }
        if let status = MpvLogPolicy.httpErrorStatus(line) { lastHttpStatus = status }
        if let status = MpvLogPolicy.serverReturnedStatus(line), lastHttpStatus == nil { lastHttpStatus = status }
        if MpvLogPolicy.isOpenFailure(line) { openFailed = true }
        if level <= Self.warnLevel && PlaybackPolicy.isTlsFailure(line) { tlsFailed = true }
        // MpvLogPolicy.isAudioTrouble feeds the smoothness check, which comes with M3b
        // No decoder at all (VideoToolbox and FFmpeg's software decoders both failed): once per file
        if let codec = MpvLogPolicy.decoderFailureCodec(line), !decoderFailureReported, !stopRequested {
            decoderFailureReported = true
            emitError(PlaybackPolicy.noDecoder, detail: codec)
        }
        let forward = level <= Self.warnLevel || (level <= Self.infoLevel && Self.infoPrefixes.contains(prefix))
        // Identical messages (numbers aside) are merged
        if forward, let admitted = logRepeats.admit(prefix: prefix, line: line, nowMs: nowMs()) {
            logInfo(admitted)
        }
    }

    private func logTracks() {
        guard let json = mpvGetString("track-list"), json != lastTracksLog else { return }
        lastTracksLog = json
        guard let tracks = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [[String: Any]] else { return }
        for track in tracks {
            var parts = ["track \(track["type"] as? String ?? "") #\(track["id"] as? Int ?? 0)", track["codec"] as? String ?? ""]
            for key in ["codec-desc", "codec-profile"] {
                if let value = track[key] as? String, !value.trimmingCharacters(in: .whitespaces).isEmpty { parts.append(value) }
            }
            if let profile = track["dolby-vision-profile"] as? Int, profile > 0 { parts.append("Dolby Vision \(profile)") }
            if let width = track["demux-w"] as? Int, width > 0 { parts.append("\(width)x\(track["demux-h"] as? Int ?? 0)") }
            if let fps = track["demux-fps"] as? Double, fps > 0 { parts.append(String(format: "%.0f fps", fps)) }
            if let channels = track["demux-channel-count"] as? Int, channels > 0 { parts.append("\(channels) ch") }
            if track["selected"] as? Bool == true { parts.append("selected") }
            logInfo(parts.joined(separator: " · "))
        }
    }

    private func logDecoding() {
        guard let codec = mpvGetString("video-codec") else { return }
        let hwdec = mpvGetString("hwdec-current") ?? "no"
        let pixfmt = mpvGetString("video-params/hw-pixelformat") ?? mpvGetString("video-params/pixelformat") ?? "?"
        let output = mpvGetString("current-vo") ?? "?"
        let summary = "video decoding: \(codec) · hwdec=\(hwdec) · pixfmt=\(pixfmt) · vo=\(output)"
        guard summary != lastDecodingLog else { return }
        lastDecodingLog = summary
        logInfo(summary)
        // The "already too slow on this device" check comes with M3b
    }

    // MARK: To the page

    private func emitProperty(_ name: String, _ value: JSValue) {
        let payload: JSObject = ["name": name, "data": value]
        DispatchQueue.main.async { [emit] in emit("property", payload) }
    }

    /// Android's errorPayload: httpStatus and a non-blank detail only when known
    private func emitError(_ code: String, httpStatus: Int? = nil, detail: String? = nil) {
        var payload: JSObject = ["engine": "libmpv", "code": code]
        if let httpStatus { payload["httpStatus"] = httpStatus }
        if let detail, !detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { payload["detail"] = detail }
        DispatchQueue.main.async { [emit] in emit("error", payload) }
    }

    /// PropertyValue → what Tauri sends to the page (JSON null is NSNull)
    static func jsValue(_ value: PropertyValue) -> JSValue {
        switch value {
        case .null: return NSNull()
        case let .bool(flag): return flag
        case let .int(number): return number
        case let .double(number): return number
        case let .string(raw): return raw
        case let .json(raw):
            guard let parsed = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) else { return raw }
            return jsValue(json: parsed)
        }
    }

    private static func jsValue(json: Any) -> JSValue {
        switch json {
        case let object as [String: Any]:
            return object.mapValues { jsValue(json: $0) } as JSObject
        case let array as [Any]:
            return array.map { jsValue(json: $0) } as JSArray
        case let raw as String:
            return raw
        case let number as NSNumber:
            return number
        default:
            return NSNull()
        }
    }

    // MARK: Diagnostics

    /// Kotlin's StreamDiagnostics.log and warn: every message is redacted first (no stream address,
    /// server name, IP or credentials)
    private func logInfo(_ message: String) {
        Logger.info("[libmpv] \(StreamDiagnostics.redact(message))", category: Self.logCategory)
    }

    private func logWarning(_ message: String) {
        Logger.error("[libmpv] \(StreamDiagnostics.redact(message))", category: Self.logCategory)
    }

    private func nowMs() -> Int64 {
        Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000)
    }

    // MARK: libmpv calls (queue only)

    private func mpvOption(_ mpv: OpaquePointer, _ name: String, _ value: String) {
        let status = mpv_set_option_string(mpv, name, value)
        if status < 0 { logWarning("option \(name) refused (\(status))") }
    }

    @discardableResult
    private func mpvCommand(_ args: [String]) -> Int32 {
        guard let handle else { return -1 }
        var cArgs: [UnsafePointer<CChar>?] = args.map { UnsafePointer<CChar>(strdup($0)) }
        cArgs.append(nil)
        defer {
            for case let arg? in cArgs { free(UnsafeMutablePointer(mutating: arg)) }
        }
        return mpv_command(handle, &cArgs)
    }

    private func mpvSetString(_ name: String, _ value: String) {
        guard let handle else { return }
        mpv_set_property_string(handle, name, value)
    }

    private func mpvSetDouble(_ name: String, _ value: Double) {
        guard let handle else { return }
        var number = value
        mpv_set_property(handle, name, MPV_FORMAT_DOUBLE, &number)
    }

    private func mpvSetFlag(_ name: String, _ value: Bool) {
        guard let handle else { return }
        var flag: Int32 = value ? 1 : 0
        mpv_set_property(handle, name, MPV_FORMAT_FLAG, &flag)
    }

    private func mpvGetString(_ name: String) -> String? {
        guard let handle, let chars = mpv_get_property_string(handle, name) else { return nil }
        defer { mpv_free(chars) }
        return String(cString: chars)
    }

    private func mpvGetDouble(_ name: String) -> Double? {
        guard let handle else { return nil }
        var number = 0.0
        return mpv_get_property(handle, name, MPV_FORMAT_DOUBLE, &number) >= 0 ? number : nil
    }

    private func mpvGetFlag(_ name: String) -> Bool? {
        guard let handle else { return nil }
        var flag: Int32 = 0
        return mpv_get_property(handle, name, MPV_FORMAT_FLAG, &flag) >= 0 ? flag != 0 : nil
    }
}
