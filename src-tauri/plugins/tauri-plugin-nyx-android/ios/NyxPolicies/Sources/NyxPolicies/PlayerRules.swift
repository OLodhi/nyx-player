import Foundation

/// An mpv property value as the page receives it, following Kotlin's MpvEngine.convert. Not a Tauri
/// type (this package can't import Tauri): the plugin maps it to JSValue.
public enum PropertyValue: Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    /// A JSON object or array, still as text; the plugin parses it
    case json(String)

    private static let flags: Set<String> = ["pause", "mute", "seeking", "paused-for-cache", "core-idle", "eof-reached", "idle-active"]
    private static let strings: Set<String> = ["hwdec-current", "video-codec", "audio-codec-name", "filename", "media-title"]

    public static func convert(_ raw: String?, name: String) -> PropertyValue {
        guard let raw else { return .null }
        if flags.contains(name) { return .bool(raw == "yes") }
        // Track ids; "auto" and "no" read as false, as on Android
        if name == "aid" || name == "sid" { return Int(raw).map { .int($0) } ?? .bool(false) }
        if strings.contains(name) { return .string(raw) }
        if raw.hasPrefix("{") || raw.hasPrefix("[") {
            let parses = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) != nil
            return parses ? .json(raw) : .string(raw)
        }
        return Double(raw).map { .double($0) } ?? .string(raw)
    }
}

/// Orientation masks as UIInterfaceOrientationMask raw values (no UIKit in this package).
public enum OrientationPolicy {
    public static let portrait: UInt = 1 << 1
    public static let landscape: UInt = (1 << 3) | (1 << 4)
    public static let all: UInt = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4)

    /// Outside the player: portrait on a phone (no landscape layout there, as on Android phones),
    /// every orientation on a tablet.
    public static func everydayMask(isPhone: Bool) -> UInt { isPhone ? portrait : all }

    /// In the player: landscape on a phone; nil on a tablet, which keeps its orientation free.
    public static func playerMask(isPhone: Bool) -> UInt? { isPhone ? landscape : nil }
}

/// Fires once the video view's size has stopped changing for `quietMs`: MPVKit 1.0.0 doesn't follow
/// the layer's size, so the engine resets mpv's video output once a rotation has settled.
public final class ResizeDebouncer {
    private let quietMs: Int64
    private var lastChange: Int64?

    public init(quietMs: Int64 = 250) {
        self.quietMs = quietMs
    }

    public func sizeChanged(nowMs: Int64) {
        lastChange = nowMs
    }

    /// True once per settled change.
    public func due(nowMs: Int64) -> Bool {
        guard let lastChange, nowMs - lastChange >= quietMs else { return false }
        self.lastChange = nil
        return true
    }
}

/// Where to reopen a stream that was closed because the app left the screen (design §6.2, as
/// Android's MpvEngine.onBackground): live at the live edge, a film where it was, pause kept.
public enum LifecyclePolicy {
    public struct ResumePoint: Equatable {
        public let url: String
        public let start: Double
        public let paused: Bool
    }

    public static func resumePoint(url: String, duration: Double, timePos: Double, paused: Bool) -> ResumePoint {
        let start = PlaybackPolicy.isLive(url: url, duration: duration) ? 0 : max(0, timePos)
        return ResumePoint(url: url, start: start, paused: paused)
    }
}

/// Certificates (DER) as one PEM file, for mpv's tls-ca-file (GnuTLS).
public enum PemBundle {
    public static func pem(fromDER certificates: [Data]) -> String {
        certificates.map { certificate in
            let body = certificate.base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
            return "-----BEGIN CERTIFICATE-----\n\(body)\n-----END CERTIFICATE-----\n"
        }.joined()
    }
}
