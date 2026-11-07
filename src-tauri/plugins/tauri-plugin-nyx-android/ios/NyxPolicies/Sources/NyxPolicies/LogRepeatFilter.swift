/// Merges repeated mpv log lines (port of Kotlin's LogRepeatFilter).
public final class LogRepeatFilter {
    public init(windowMs: Int64 = 2_000, maxKeys: Int = 200) {}

    public func admit(prefix: String, line: String, nowMs: Int64) -> String? { nil } // not implemented yet
}
