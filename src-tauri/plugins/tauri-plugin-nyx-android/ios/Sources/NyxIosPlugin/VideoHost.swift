import UIKit
import WebKit

/// Puts the video view below the WKWebView and makes the page see-through while a stream shows,
/// as Tauri's barcode-scanner plugin does in its windowed mode. The page's own `player-active`
/// styles make html/body transparent; this makes the WKWebView itself transparent.
/// A container on purpose: picture-in-picture (M5) will add an AVPlayerLayer here.
/// Main thread only.
final class VideoHost {
    private struct Backdrop {
        let opaque: Bool
        let background: UIColor?
        let scrollBackground: UIColor?
        let underPage: UIColor
    }

    private weak var webView: WKWebView?
    private(set) var videoView: VideoView?
    private var backdrop: Backdrop?

    init(webView: WKWebView) {
        self.webView = webView
    }

    /// Inserts the video view once, below the web view, full size (it follows rotations by itself).
    @discardableResult
    func attachIfNeeded() -> VideoView? {
        if let videoView { return videoView }
        guard let webView, let superview = webView.superview else { return nil }
        let view = VideoView(frame: superview.bounds)
        superview.insertSubview(view, belowSubview: webView)
        videoView = view
        return view
    }

    /// Makes the web view transparent and shows the video view. Saves what it changes, once.
    func showStream() {
        guard let webView, let videoView else { return }
        if backdrop == nil {
            backdrop = Backdrop(
                opaque: webView.isOpaque,
                background: webView.backgroundColor,
                scrollBackground: webView.scrollView.backgroundColor,
                underPage: webView.underPageBackgroundColor)
        }
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.underPageBackgroundColor = .clear
        videoView.isHidden = false
    }

    /// Hides the video view and restores the web view. Call it after mpv has stopped drawing: a
    /// hidden layer can stall the video output.
    func hideStream() {
        videoView?.isHidden = true
        guard let webView, let saved = backdrop else { return }
        webView.isOpaque = saved.opaque
        webView.backgroundColor = saved.background
        webView.scrollView.backgroundColor = saved.scrollBackground
        webView.underPageBackgroundColor = saved.underPage
        backdrop = nil
    }

    /// mpv's `wid`: the layer's address, not retained (the view keeps the layer alive).
    var layerPointer: Int64? {
        guard let videoView else { return nil }
        return Int64(Int(bitPattern: Unmanaged.passUnretained(videoView.metalLayer).toOpaque()))
    }
}
