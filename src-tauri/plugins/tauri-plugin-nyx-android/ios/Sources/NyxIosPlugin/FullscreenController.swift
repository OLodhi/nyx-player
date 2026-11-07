import NyxPolicies
import Tauri
import UIKit

/// The player's fullscreen: on iPhone, landscape with the status bar hidden and the home indicator
/// auto-hidden, then back to portrait, as Android phones do (DevicePolicy.locksPortrait: no
/// landscape layout outside the player). iPad keeps every orientation. Main thread only.
final class FullscreenController {
    private let chrome: TaoChrome
    private(set) var isFullscreen = false

    init(chrome: TaoChrome) {
        self.chrome = chrome
    }

    private var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    /// Outside the player: portrait on iPhone, free on iPad. Info.ios.plist lists landscape on
    /// iPhone too, because an orientation must be listed there before it can be requested.
    func applyEverydayLock() {
        chrome.setSupportedOrientations(UIInterfaceOrientationMask(rawValue: OrientationPolicy.everydayMask(isPhone: isPhone)))
        if isPhone { request(.portrait) }
    }

    func enter() {
        isFullscreen = true
        if let mask = OrientationPolicy.playerMask(isPhone: isPhone) {
            // Allowed first, then requested: a request outside the allowed mask fails
            let landscape = UIInterfaceOrientationMask(rawValue: mask)
            chrome.setSupportedOrientations(landscape)
            request(landscape)
        }
        chrome.setStatusBarHidden(true)
        chrome.setHomeIndicatorAutoHidden(true)
    }

    func exit() {
        isFullscreen = false
        chrome.setStatusBarHidden(false)
        chrome.setHomeIndicatorAutoHidden(false)
        applyEverydayLock()
    }

    private func request(_ mask: UIInterfaceOrientationMask) {
        guard let scene = chrome.viewController?.view.window?.windowScene else { return }
        if #available(iOS 16.0, *) {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { error in
                Logger.error("orientation request refused: \(error.localizedDescription)")
            }
        } else {
            // iOS 15: no geometry request; nudge the device orientation, then let UIKit re-check
            let target: UIInterfaceOrientation = mask.contains(.portrait) ? .portrait : .landscapeRight
            UIDevice.current.setValue(target.rawValue, forKey: "orientation")
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
