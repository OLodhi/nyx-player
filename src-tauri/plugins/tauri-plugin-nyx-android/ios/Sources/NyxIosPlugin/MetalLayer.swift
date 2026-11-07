import QuartzCore
import UIKit

/// The layer libmpv draws into through MoltenVK (passed to mpv as `wid`). It keeps the two
/// workarounds of MPVKit's iOS demo (Demo/Demo-iOS/.../Metal/MetalLayer.swift, MPVKit 1.0.0),
/// changing one of them to avoid a deadlock.
final class MetalLayer: CAMetalLayer {
    /// MoltenVK sets the size to 1x1 to force a presentation to complete, which flickers and can
    /// leave the layer stuck at 1x1 (the same fix as mpv PR #13651): ignore those sizes.
    override var drawableSize: CGSize {
        get { super.drawableSize }
        set {
            if newValue.width > 1 && newValue.height > 1 {
                super.drawableSize = newValue
            }
        }
    }

    /// MoltenVK sets this from mpv's video thread whenever it creates a swapchain, and it only takes
    /// effect on the main thread. MPVKit's demo hops with `main.sync`, which deadlocks if the main
    /// thread is waiting on an mpv call at that moment: hop asynchronously instead.
    @available(iOS 16.0, *)
    override var wantsExtendedDynamicRangeContent: Bool {
        get { super.wantsExtendedDynamicRangeContent }
        set {
            if Thread.isMainThread {
                super.wantsExtendedDynamicRangeContent = newValue
            } else {
                DispatchQueue.main.async { [weak self] in self?.applyExtendedDynamicRange(newValue) }
            }
        }
    }

    @available(iOS 16.0, *)
    private func applyExtendedDynamicRange(_ value: Bool) {
        super.wantsExtendedDynamicRangeContent = value
    }
}
