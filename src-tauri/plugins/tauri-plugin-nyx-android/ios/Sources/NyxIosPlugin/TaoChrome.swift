import UIKit
import WebKit

/// Bridge to the setters of tao's `TaoUIViewController`, the root view controller of a Tauri 2.11
/// iOS app (tao 0.35, platform_impl/ios/view.rs). It already answers supportedInterfaceOrientations,
/// prefersStatusBarHidden and prefersHomeIndicatorAutoHidden, and each setter makes UIKit read the
/// value again. They are not a Tauri API, so every call checks that the selector exists.
/// Main thread only.
final class TaoChrome {
    private weak var webView: WKWebView?

    init(webView: WKWebView) {
        self.webView = webView
    }

    /// The view controller that owns the web view's superview (Tauri's PluginManager.shared is
    /// internal to Tauri, so plugins can't use its viewController).
    var viewController: UIViewController? {
        var responder: UIResponder? = webView
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return webView?.window?.rootViewController
    }

    @discardableResult
    func setSupportedOrientations(_ mask: UIInterfaceOrientationMask) -> Bool {
        guard send("setSupportedInterfaceOrientations:", mask: mask.rawValue) else { return false }
        if #available(iOS 16.0, *) {
            viewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        }
        return true
    }

    @discardableResult
    func setStatusBarHidden(_ hidden: Bool) -> Bool {
        send("setPrefersStatusBarHidden:", bool: hidden)
    }

    /// The home indicator can only be auto-hidden: it fades without touches and comes back on touch.
    @discardableResult
    func setHomeIndicatorAutoHidden(_ hidden: Bool) -> Bool {
        send("setPrefersHomeIndicatorAutoHidden:", bool: hidden)
    }

    private func implementation(_ name: String) -> (AnyObject, Selector, IMP)? {
        guard let controller = viewController else { return nil }
        let selector = NSSelectorFromString(name)
        guard controller.responds(to: selector),
              let method = class_getInstanceMethod(type(of: controller), selector)
        else { return nil }
        return (controller, selector, method_getImplementation(method))
    }

    private func send(_ name: String, bool value: Bool) -> Bool {
        guard let found = implementation(name) else { return false }
        let (target, selector, imp) = found
        typealias Setter = @convention(c) (AnyObject, Selector, Bool) -> Void
        unsafeBitCast(imp, to: Setter.self)(target, selector, value)
        return true
    }

    private func send(_ name: String, mask value: UInt) -> Bool {
        guard let found = implementation(name) else { return false }
        let (target, selector, imp) = found
        typealias Setter = @convention(c) (AnyObject, Selector, UInt) -> Void
        unsafeBitCast(imp, to: Setter.self)(target, selector, value)
        return true
    }
}
