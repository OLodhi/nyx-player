#if DEBUG
import Foundation
import Tauri
import WebKit

/// CI only: debug builds launched with NYX_SMOKE_PLAY=<url> (`SIMCTL_CHILD_NYX_SMOKE_PLAY=… simctl
/// launch`). Proves on the Simulator that the libmpv engine plays: about 5 s after load it plays that
/// address (a clip the CI Mac makes and serves on its loopback, never a real stream), then about 10 s
/// later writes Library/Caches/nyx-smoke.json with what the page would have seen:
/// - `timePos`: the last `time-pos` event, and `timePosEvents`, how many arrived;
/// - `errors`: the codes of the `error` events;
/// - `vo`, `hwdec` and `vid`: mpv's video output, decoder and video track (a black screenshot with
///   time advancing is the video output, not the engine);
/// - `ca.count`: the certificates in the CA file mpv is given for https.
/// The play command's checks (PlayerInputPolicy) are not applied: the address comes from CI.
final class SmokePlayCheck {
    private var lastTimePos: Double?
    private var timePosEvents = 0
    private var errors: [String] = []

    /// Starts the check if requested. The plugin keeps the result and passes it every engine event.
    static func startIfRequested(webView: WKWebView, engine: MpvEngine, caFile: @escaping () -> URL?) -> SmokePlayCheck? {
        guard let url = ProcessInfo.processInfo.environment["NYX_SMOKE_PLAY"], !url.isEmpty else { return nil }
        let check = SmokePlayCheck()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            // What the page does when the player opens (PlayerContext): its own background goes
            // transparent, so the video below shows in the screenshot
            webView.evaluateJavaScript(
                "document.documentElement.classList.add('player-active');document.body.classList.add('player-active')")
            var created: Bool?
            engine.play(url: url, start: 0, userAgent: nil) { ok in
                DispatchQueue.main.async { created = ok }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                // Read on the engine's queue (getProperty answers there), never on the main queue
                engine.getProperty("current-vo") { vo in
                    engine.getProperty("hwdec-current") { hwdec in
                        engine.getProperty("vid") { vid in
                            let certificates = certificateCount(caFile())
                            DispatchQueue.main.async {
                                check.write([
                                    "created": created.map { $0 as Any } ?? NSNull(),
                                    "timePos": check.lastTimePos.map { $0 as Any } ?? NSNull(),
                                    "timePosEvents": check.timePosEvents,
                                    "errors": check.errors,
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
        }
        return check
    }

    /// Main queue: every event the engine sends the page
    func observe(_ event: String, _ payload: JSObject) {
        if event == "property", payload["name"] as? String == "time-pos", let value = payload["data"] as? Double {
            lastTimePos = value
            timePosEvents += 1
        } else if event == "error" {
            errors.append(payload["code"] as? String ?? "?")
        }
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
        try? data.write(to: directory.appendingPathComponent("nyx-smoke.json"))
    }
}
#endif
