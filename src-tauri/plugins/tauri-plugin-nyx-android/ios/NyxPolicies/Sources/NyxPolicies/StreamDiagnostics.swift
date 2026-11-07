import Foundation

/// Player logs without stream addresses, server names or IPs (port of Kotlin's StreamDiagnostics).
/// Same patterns, same order. Keep `[=:]` as written: `[:=]` crashed ICU on Android, and
/// NSRegularExpression is ICU too.
public enum StreamDiagnostics {
    private static let url = Regex.make(#"[a-zA-Z][a-zA-Z0-9+.-]*://[^\s'"<>]+"#)
    private static let host = Regex.make(#"(?i)\b(hostname|host)(\s*[=:]\s*|\s+)['"]?[^\s'",;)]*\.[^\s'",;):]+"#)
    private static let ipv6 = Regex.make(
        #"\[[0-9a-fA-F:]*::[0-9a-fA-F:.]*](?::\d{1,5})?"#
            + #"|\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b"#
            + #"|(?<![\w:])(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5})?(?![\w:])"#)
    private static let xtreamPath = Regex.make(#"(?i)/(live|movie|series|timeshift|hls|play)/[^/\s'"<>]+/[^/\s'"<>]+/"#)
    private static let ipv4 = Regex.make(#"\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b"#)
    private static let kind = Regex.make("^/(live|movie|series)/")

    public static func redact(_ text: String) -> String {
        var result = Regex.replace(url, text, with: "<url>")
        result = Regex.replace(xtreamPath, result, with: "/$1/***/***/")
        result = Regex.replace(host, result, with: "$1$2<host>")
        result = Regex.replace(ipv6, result, with: "<ip>")
        return Regex.replace(ipv4, result, with: "<ip>")
    }

    /// "live · ts": the kind of stream and its extension, without the address.
    public static func describeUrl(_ url: String) -> String {
        let path = URL(string: url)?.path ?? ""
        let streamKind = Regex.firstGroup(kind, path) ?? "stream"
        var ext = "?"
        if let dot = path.lastIndex(of: ".") {
            let candidate = path[path.index(after: dot)...]
            if (1...5).contains(candidate.count), !candidate.contains("/") { ext = String(candidate) }
        }
        return "\(streamKind) · \(ext)"
    }
}
