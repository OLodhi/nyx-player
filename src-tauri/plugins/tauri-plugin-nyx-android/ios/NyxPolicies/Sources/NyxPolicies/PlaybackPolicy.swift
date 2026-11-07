/// Live or film, https, TLS failures, load-failure code, cache sizes (port of Kotlin's PlaybackPolicy).
public enum PlaybackPolicy {
    public static let tlsCaUnavailable = ""
    public static let loadFailed = ""
    public static let noDecoder = ""

    public struct CacheSizes: Equatable {
        public let forwardBytes: Int64
        public let backBytes: Int64
        public init(forwardBytes: Int64, backBytes: Int64) {
            self.forwardBytes = forwardBytes
            self.backBytes = backBytes
        }
    }

    public static func isVodUrl(_ url: String) -> Bool { false } // not implemented yet
    public static func isLive(url: String, duration: Double) -> Bool { false } // not implemented yet
    public static func isHttps(_ url: String) -> Bool { false } // not implemented yet
    public static func isTlsFailure(_ logLine: String) -> Bool { false } // not implemented yet
    public static func loadFailureCode(tlsFailed: Bool, certificatesAvailable: Bool) -> String { "" } // not implemented yet
    public static func cacheSizes(totalMemoryBytes: Int64, lowRamDevice: Bool) -> CacheSizes {
        CacheSizes(forwardBytes: 0, backBytes: 0) // not implemented yet
    }
    public static func startOption(_ seconds: Double) -> String { "" } // not implemented yet
}
