import Foundation

/// What the page may ask the player to open or read (port of Kotlin's PlayerInputPolicy): network
/// streams only, a bounded user agent, and the properties the interface reads.
public enum PlayerInputPolicy {
    public static let streamSchemes: Set<String> = ["http", "https", "rtmp", "rtmps", "rtsp", "rtsps"]
    public static let maxUserAgentLength = 300
    public static let readableProperties: Set<String> = [
        "fullscreen", "engine",
        "pause", "time-pos", "duration", "volume", "mute", "speed", "seeking", "paused-for-cache",
        "core-idle", "idle-active", "eof-reached", "aid", "sid", "sub-scale", "track-list", "filename",
        "media-title", "video-params", "video-codec", "audio-codec-name", "audio-params",
        "container-fps", "video-bitrate", "audio-bitrate", "frame-drop-count",
        "decoder-frame-drop-count", "demuxer-cache-state", "hwdec-current",
    ]

    public static func isAllowedStreamUrl(_ url: String) -> Bool {
        if Regex.hasIsoControl(url) { return false }
        // UTF-16 positions, like Kotlin's indexOf and length
        let text = url as NSString
        let separator = text.range(of: "://").location
        if separator == NSNotFound || separator <= 0 || separator + 3 >= text.length { return false }
        return streamSchemes.contains(text.substring(to: separator).lowercased())
    }

    public static func isAllowedUserAgent(_ userAgent: String?) -> Bool {
        guard let userAgent else { return true }
        return (userAgent as NSString).length <= maxUserAgentLength && !Regex.hasIsoControl(userAgent)
    }

    public static func isReadableProperty(_ name: String) -> Bool { readableProperties.contains(name) }
}
