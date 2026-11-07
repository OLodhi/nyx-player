import Foundation

/// NSRegularExpression helpers for the ported Kotlin rules (ICU, like Android's regex engine).
enum Regex {
    static func make(_ pattern: String, caseInsensitive: Bool = false) -> NSRegularExpression {
        // The patterns are constants, exercised by the tests
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    static func contains(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    static func firstGroup(_ regex: NSRegularExpression, _ text: String) -> String? {
        guard let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[range])
    }

    static func replace(_ regex: NSRegularExpression, _ text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    /// Kotlin's Char.isISOControl: U+0000–U+001F and U+007F–U+009F.
    static func hasIsoControl(_ text: String) -> Bool {
        text.unicodeScalars.contains { (0x00...0x1F).contains($0.value) || (0x7F...0x9F).contains($0.value) }
    }
}
