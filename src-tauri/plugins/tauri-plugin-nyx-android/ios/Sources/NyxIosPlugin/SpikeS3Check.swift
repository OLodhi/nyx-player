#if DEBUG
import Foundation
import UIKit
import WebKit

/// CI only: debug builds launched with NYX_SPIKE_S3=1 (`SIMCTL_CHILD_NYX_SPIKE_S3=1 simctl launch`).
/// Proves on the Simulator what the player needs from UIKit and tao: a view below the page that
/// shows through it, landscape, the status bar hidden and the home indicator auto-hidden, then
/// back. A plain magenta view is used rather than Metal, so the CI machine's GPU can't affect it.
/// Writes Library/Caches/nyx-spike-s3.json (fullscreen) and nyx-spike-s3-exit.json (after exit).
enum SpikeS3Check {
    static func startIfRequested(webView: WKWebView, fullscreen: FullscreenController, chrome: TaoChrome) {
        guard ProcessInfo.processInfo.environment["NYX_SPIKE_S3"] == "1" else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            guard let host = webView.superview else {
                write(["error": "the web view has no superview"], to: "nyx-spike-s3.json")
                return
            }
            let probe = UIView(frame: host.bounds)
            probe.backgroundColor = .magenta
            probe.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            probe.isUserInteractionEnabled = false
            host.insertSubview(probe, belowSubview: webView)
            let opaque = webView.isOpaque
            let background = webView.backgroundColor
            let scrollBackground = webView.scrollView.backgroundColor
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear
            webView.evaluateJavaScript(
                "document.documentElement.classList.add('player-active');document.body.classList.add('player-active')")
            fullscreen.enter()

            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                write(snapshot(webView: webView, probe: probe, chrome: chrome), to: "nyx-spike-s3.json")
                fullscreen.exit()
                probe.removeFromSuperview()
                webView.isOpaque = opaque
                webView.backgroundColor = background
                webView.scrollView.backgroundColor = scrollBackground
                webView.evaluateJavaScript(
                    "document.documentElement.classList.remove('player-active');document.body.classList.remove('player-active')")
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    write(snapshot(webView: webView, probe: nil, chrome: chrome), to: "nyx-spike-s3-exit.json")
                }
            }
        }
    }

    private static func snapshot(webView: WKWebView, probe: UIView?, chrome: TaoChrome) -> [String: Any] {
        let controller = chrome.viewController
        let subviews = webView.superview?.subviews ?? []
        var below = false
        if let probe, let probeIndex = subviews.firstIndex(of: probe), let webIndex = subviews.firstIndex(of: webView) {
            below = probeIndex < webIndex
        }
        var orientation = UIInterfaceOrientation.unknown
        if let scene = webView.window?.windowScene {
            if #available(iOS 16.0, *) {
                orientation = scene.effectiveGeometry.interfaceOrientation
            } else {
                orientation = scene.interfaceOrientation
            }
        }
        return [
            "superviewClass": webView.superview.map { String(describing: type(of: $0)) } ?? "",
            "viewControllerClass": controller.map { String(describing: type(of: $0)) } ?? "",
            "subviews": subviews.map { String(describing: type(of: $0)) },
            "videoBelowWebView": below,
            "orientation": name(of: orientation),
            "statusBarHidden": controller?.prefersStatusBarHidden ?? false,
            "homeIndicatorAutoHidden": controller?.prefersHomeIndicatorAutoHidden ?? false,
            "supportedOrientations": controller?.supportedInterfaceOrientations.rawValue ?? 0,
            "webViewOpaque": webView.isOpaque,
        ]
    }

    private static func name(of orientation: UIInterfaceOrientation) -> String {
        switch orientation {
        case .portrait: return "portrait"
        case .portraitUpsideDown: return "portraitUpsideDown"
        case .landscapeLeft: return "landscapeLeft"
        case .landscapeRight: return "landscapeRight"
        default: return "unknown"
        }
    }

    private static func write(_ value: [String: Any], to fileName: String) {
        guard let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first,
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        else { return }
        try? data.write(to: directory.appendingPathComponent(fileName))
    }
}
#endif
