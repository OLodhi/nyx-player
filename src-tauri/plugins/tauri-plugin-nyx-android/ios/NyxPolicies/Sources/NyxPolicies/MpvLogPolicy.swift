import Foundation

/// What mpv's log lines say about a failed stream (port of Kotlin's MpvLogPolicy).
public enum MpvLogPolicy {
    private static let httpError = Regex.make("HTTP error (\\d{3})")
    private static let serverReturned = Regex.make("Server returned (\\d{3})")
    private static let openFailure = Regex.make("Failed to open|Opening failed|Failed to recognize file format|No such file")
    private static let audioTrouble = Regex.make("Audio device underrun|Audio/Video desynchronisation")
    private static let decoderFailure = Regex.make("Failed to initialize a decoder for codec")

    public static func httpErrorStatus(_ line: String) -> Int? {
        Regex.firstGroup(httpError, line).flatMap { Int($0) }
    }

    public static func serverReturnedStatus(_ line: String) -> Int? {
        Regex.firstGroup(serverReturned, line).flatMap { Int($0) }
    }

    public static func isOpenFailure(_ line: String) -> Bool { Regex.contains(openFailure, line) }

    public static func isAudioTrouble(_ line: String) -> Bool { Regex.contains(audioTrouble, line) }

    /// The codec named after "codec" (empty if none), or nil when the line isn't a decoder failure.
    public static func decoderFailureCodec(_ line: String) -> String? {
        guard Regex.contains(decoderFailure, line), let codec = line.range(of: "codec") else { return nil }
        return String(line[codec.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: " '."))
    }
}
