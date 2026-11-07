/// What mpv's log lines say about a failed stream (port of Kotlin's MpvLogPolicy).
public enum MpvLogPolicy {
    public static func httpErrorStatus(_ line: String) -> Int? { nil } // not implemented yet
    public static func serverReturnedStatus(_ line: String) -> Int? { nil } // not implemented yet
    public static func isOpenFailure(_ line: String) -> Bool { false } // not implemented yet
    public static func isAudioTrouble(_ line: String) -> Bool { false } // not implemented yet
    public static func decoderFailureCodec(_ line: String) -> String? { nil } // not implemented yet
}
