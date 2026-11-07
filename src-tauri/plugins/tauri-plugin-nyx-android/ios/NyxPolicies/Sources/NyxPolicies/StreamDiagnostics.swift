/// Player logs without stream addresses, server names or IPs (port of Kotlin's StreamDiagnostics).
public enum StreamDiagnostics {
    public static func redact(_ text: String) -> String { text } // not implemented yet
    public static func describeUrl(_ url: String) -> String { "" } // not implemented yet
}
