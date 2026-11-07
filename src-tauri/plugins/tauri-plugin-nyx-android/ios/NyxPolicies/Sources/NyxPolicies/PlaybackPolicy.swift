import Foundation

/// Live or film, https, TLS failures, load-failure code, cache sizes (port of Kotlin's
/// PlaybackPolicy), plus mpv's `start` option.
public enum PlaybackPolicy {
    /// Error codes the page knows (playbackErrors.ts, classifyNativeError)
    public static let tlsCaUnavailable = "TLS_CA_UNAVAILABLE"
    public static let loadFailed = "MPV_LOAD_FAILED"
    public static let noDecoder = "NO_DECODER"

    public struct CacheSizes: Equatable {
        public let forwardBytes: Int64
        public let backBytes: Int64
        public init(forwardBytes: Int64, backBytes: Int64) {
            self.forwardBytes = forwardBytes
            self.backBytes = backBytes
        }
    }

    private static let vodUrl = Regex.make("^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]+/(movie|series)/")
    /// Kotlin's TLS_FAILURE, plus GnuTLS's verification messages (MPVKit's FFmpeg uses GnuTLS)
    private static let tlsFailure = Regex.make(
        "^tls:|mbedtls|No CA chain|certificate (verification|is not correctly signed)"
            + "|Unable to verify peer certificate|Peer certificate failed verification"
            + "|certificate's owner does not match hostname",
        caseInsensitive: true)
    private static let mib: Int64 = 1024 * 1024
    private static let lowMemoryBytes: Int64 = 3 * 1024 * mib

    public static func isVodUrl(_ url: String) -> Bool { Regex.contains(vodUrl, url) }

    public static func isLive(url: String, duration: Double) -> Bool { duration <= 0 && !isVodUrl(url) }

    public static func isHttps(_ url: String) -> Bool {
        url.drop { $0.isWhitespace }.lowercased().hasPrefix("https://")
    }

    public static func isTlsFailure(_ logLine: String) -> Bool { Regex.contains(tlsFailure, logLine) }

    public static func loadFailureCode(tlsFailed: Bool, certificatesAvailable: Bool) -> String {
        tlsFailed && !certificatesAvailable ? tlsCaUnavailable : loadFailed
    }

    /// 32 + 8 MiB on a low-memory device (under 3 GiB), otherwise 64 + 32. Unknown memory (0): normal.
    public static func cacheSizes(totalMemoryBytes: Int64, lowRamDevice: Bool) -> CacheSizes {
        if lowRamDevice || (1..<lowMemoryBytes).contains(totalMemoryBytes) {
            return CacheSizes(forwardBytes: 32 * mib, backBytes: 8 * mib)
        }
        return CacheSizes(forwardBytes: 64 * mib, backBytes: 32 * mib)
    }

    /// mpv's `start`: "none" from the beginning, otherwise plain decimals (never exponent notation).
    public static func startOption(_ seconds: Double) -> String {
        guard seconds > 0, seconds.isFinite else { return "none" }
        if seconds == seconds.rounded(), seconds < 1e15 { return String(Int64(seconds)) }
        var text = String(format: "%.3f", seconds)
        while text.hasSuffix("0") { text.removeLast() }
        if text.hasSuffix(".") { text.removeLast() }
        return text
    }
}
