import QuartzCore
import UIKit

/// The full-screen view the video is drawn in, placed below the web page (VideoHost). It takes no
/// touches: the transparent page above keeps them for the player controls.
final class VideoView: UIView {
    override class var layerClass: AnyClass { MetalLayer.self }

    var metalLayer: MetalLayer {
        // layerClass guarantees the type
        // swiftlint:disable:next force_cast
        layer as! MetalLayer
    }

    /// Called after every layout (rotation, iPad multitasking): MpvEngine debounces it, then makes
    /// mpv pick up the new size (MPVKit 1.0.0 doesn't follow the layer size by itself).
    var onSizeChange: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        autoresizingMask = [.flexibleWidth, .flexibleHeight]
        backgroundColor = .black
        isHidden = true
        metalLayer.framebufferOnly = true
    }

    required init?(coder: NSCoder) {
        fatalError("VideoView is created in code only")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard let scale = window?.screen.nativeScale else { return }
        contentScaleFactor = scale
        metalLayer.contentsScale = scale
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        // After MoltenVK's first swapchain the drawable size no longer follows the bounds by itself
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        metalLayer.drawableSize = CGSize(
            width: bounds.width * contentScaleFactor,
            height: bounds.height * contentScaleFactor)
        CATransaction.commit()
        onSizeChange?()
    }
}
