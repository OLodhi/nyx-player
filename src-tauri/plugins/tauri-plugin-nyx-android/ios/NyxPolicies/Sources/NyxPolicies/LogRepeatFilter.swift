import Foundation

/// Merges repeated mpv log lines (port of Kotlin's LogRepeatFilter): a corrupt stream repeats the
/// same message many times a second. Lines differing only in their numbers count as the same.
public final class LogRepeatFilter {
    private struct Seen {
        let lastLoggedAt: Int64
        var suppressed = 0
    }

    private static let digits = Regex.make(#"\d+"#)
    private let windowMs: Int64
    private let maxKeys: Int
    private var seen: [String: Seen] = [:]

    public init(windowMs: Int64 = 2_000, maxKeys: Int = 200) {
        self.windowMs = windowMs
        self.maxKeys = maxKeys
    }

    /// The line to log ("prefix: line", with " (+N identiques)" after hidden repeats), or nil to drop it.
    public func admit(prefix: String, line: String, nowMs: Int64) -> String? {
        let key = "\(prefix)|\(Regex.replace(Self.digits, line, with: "#"))"
        if let previous = seen[key], nowMs - previous.lastLoggedAt < windowMs {
            seen[key]?.suppressed += 1
            return nil
        }
        let hidden = seen[key]?.suppressed ?? 0
        let suffix = hidden > 0 ? " (+\(hidden) identiques)" : ""
        // A corrupt stream gives ever-different messages: the table must not grow forever
        if seen.count > maxKeys { seen.removeAll() }
        seen[key] = Seen(lastLoggedAt: nowMs)
        return "\(prefix): \(line)\(suffix)"
    }
}
