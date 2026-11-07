#if DEBUG
import Foundation
import Tauri
import WebKit

/// CI only: debug builds launched with NYX_SMOKE_PLAY=<url> (`SIMCTL_CHILD_NYX_SMOKE_PLAY=… simctl
/// launch`). Proves on the Simulator that the libmpv engine plays: about 5 s after load it plays that
/// address (a clip the CI Mac makes and serves on its loopback, never a real stream). Once the clip
/// has played `targetSeconds`, or `deadlineSeconds` after the play request at the latest, it writes
/// Library/Caches/nyx-smoke.json with what the page would have seen:
/// - `timePos`: the last `time-pos` event, and `timePosEvents`, how many arrived;
/// - `reachedTarget`: whether `timePos` reached `targetSeconds` before the deadline;
/// - `secondsToFirstTimePos` and `secondsToResult`: from the play request to the first `time-pos`
///   event and to this file (the start-up time in the Simulator);
/// - `errors`: the codes of the `error` events;
/// - `vo`, `hwdec` and `vid`: mpv's video output, decoder and video track (a black screenshot with
///   time advancing is the video output, not the engine);
/// - `ca.count`: the certificates in the CA file mpv is given for https.
/// The play command's checks (PlayerInputPolicy) are not applied: the address comes from CI.
/// Main queue throughout, except the property reads, which answer on the engine's queue.
final class SmokePlayCheck {
    /// Playback reached by the time the result is written (a fixed delay left little margin)
    static let targetSeconds: Double = 5
    /// From the play request: the result is written anyway, so CI never waits for nothing
    static let deadlineSeconds: Double = 30

    private let engine: MpvEngine
    private let caFile: () -> URL?
    private var playRequestedAt: Date?
    private var firstTimePosAt: Date?
    private var lastTimePos: Double?
    private var timePosEvents = 0
    private var errors: [String] = []
    private var created: Bool?
    private var finishing = false

    private init(engine: MpvEngine, caFile: @escaping () -> URL?) {
        self.engine = engine
        self.caFile = caFile
    }

    /// Starts the check if requested. The plugin keeps the result and passes it every engine event.
    static func startIfRequested(webView: WKWebView, engine: MpvEngine, caFile: @escaping () -> URL?) -> SmokePlayCheck? {
        guard let url = ProcessInfo.processInfo.environment["NYX_SMOKE_PLAY"], !url.isEmpty else { return nil }
        let check = SmokePlayCheck(engine: engine, caFile: caFile)
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            // What the page does when the player opens (PlayerContext): its own background goes
            // transparent, so the video below shows in the screenshot
            webView.evaluateJavaScript(
                "document.documentElement.classList.add('player-active');document.body.classList.add('player-active')")
            check.playRequestedAt = Date()
            engine.play(url: url, start: 0, userAgent: nil) { ok in
                DispatchQueue.main.async { check.created = ok }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + deadlineSeconds) { check.finish() }
        }
        return check
    }

    /// Main queue: every event the engine sends the page
    func observe(_ event: String, _ payload: JSObject) {
        if event == "property", payload["name"] as? String == "time-pos", let value = payload["data"] as? Double {
            if firstTimePosAt == nil { firstTimePosAt = Date() }
            lastTimePos = value
            timePosEvents += 1
            if value >= Self.targetSeconds { finish() }
        } else if event == "error" {
            errors.append(payload["code"] as? String ?? "?")
        }
    }

    /// Main queue. Once: reads mpv's state on the engine's queue, then writes the file here.
    private func finish() {
        guard !finishing else { return }
        finishing = true
        engine.getProperty("current-vo") { [self] vo in
            engine.getProperty("hwdec-current") { [self] hwdec in
                engine.getProperty("vid") { [self] vid in
                    let certificates = Self.certificateCount(caFile())
                    DispatchQueue.main.async { [self] in
                        let now = Date()
                        write([
                            "created": created.map { $0 as Any } ?? NSNull(),
                            "timePos": lastTimePos.map { $0 as Any } ?? NSNull(),
                            "timePosEvents": timePosEvents,
                            "reachedTarget": (lastTimePos ?? 0) >= Self.targetSeconds,
                            "secondsToFirstTimePos": seconds(from: playRequestedAt, to: firstTimePosAt),
                            "secondsToResult": seconds(from: playRequestedAt, to: now),
                            "errors": errors,
                            "vo": vo,
                            "hwdec": hwdec,
                            "vid": vid,
                            "ca": ["count": certificates],
                        ])
                    }
                }
            }
        }
    }

    private func seconds(from start: Date?, to end: Date?) -> Any {
        guard let start, let end else { return NSNull() }
        return (end.timeIntervalSince(start) * 10).rounded() / 10
    }

    private static func certificateCount(_ file: URL?) -> Int {
        guard let file, let pem = try? String(contentsOf: file, encoding: .utf8) else { return 0 }
        return pem.components(separatedBy: "-----BEGIN CERTIFICATE-----").count - 1
    }

    private func write(_ value: [String: Any]) {
        guard let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
              JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        else { return }
        // Atomic: CI reads the file as soon as it appears
        try? data.write(to: directory.appendingPathComponent("nyx-smoke.json"), options: .atomic)
    }
}
#endif
