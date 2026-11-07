import Foundation

/// An mpv property value as the page receives it (Kotlin's MpvEngine.convert). Not a Tauri type:
/// the plugin maps it to JSValue.
public enum PropertyValue: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case json(String)

    public static func convert(_ raw: String?, name: String) -> PropertyValue { .null } // not implemented yet
}

/// Orientation masks as UIInterfaceOrientationMask raw values (no UIKit here).
public enum OrientationPolicy {
    public static let portrait: UInt = 0
    public static let landscape: UInt = 0
    public static let all: UInt = 0

    public static func everydayMask(isPhone: Bool) -> UInt { 0 } // not implemented yet
    public static func playerMask(isPhone: Bool) -> UInt? { 0 } // not implemented yet
}

/// Fires once the video view's size has stopped changing for `quietMs`.
public final class ResizeDebouncer {
    public init(quietMs: Int64 = 250) {}

    public func sizeChanged(nowMs: Int64) {} // not implemented yet
    public func due(nowMs: Int64) -> Bool { false } // not implemented yet
}

/// Where to reopen a stream closed because the app left the screen.
public enum LifecyclePolicy {
    public struct ResumePoint: Equatable {
        public let url: String
        public let start: Double
        public let paused: Bool
    }

    public static func resumePoint(url: String, duration: Double, timePos: Double, paused: Bool) -> ResumePoint {
        ResumePoint(url: "", start: -1, paused: !paused) // not implemented yet
    }
}

/// Certificates (DER) as one PEM file for mpv's tls-ca-file (GnuTLS).
public enum PemBundle {
    public static func pem(fromDER certificates: [Data]) -> String { "" } // not implemented yet
}
