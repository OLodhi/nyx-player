/// What the page may ask the player to open or read (port of Kotlin's PlayerInputPolicy).
public enum PlayerInputPolicy {
    public static let streamSchemes: Set<String> = []
    public static let maxUserAgentLength = 0
    public static let readableProperties: Set<String> = []

    public static func isAllowedStreamUrl(_ url: String) -> Bool { false } // not implemented yet
    public static func isAllowedUserAgent(_ userAgent: String?) -> Bool { false } // not implemented yet
    public static func isReadableProperty(_ name: String) -> Bool { false } // not implemented yet
}
