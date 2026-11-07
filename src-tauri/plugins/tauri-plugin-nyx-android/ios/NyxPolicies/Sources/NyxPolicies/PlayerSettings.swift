/// Tracks, picture format and clamps (port of Kotlin's PlayerSettings).
public enum PlayerSettings {
    public struct Resize: Equatable {
        public let keepAspect: String
        public let panscan: Double
        public init(keepAspect: String, panscan: Double) {
            self.keepAspect = keepAspect
            self.panscan = panscan
        }
    }

    /// "audio" → aid; any other type → sid, as before.
    public static func trackProperty(_ type: String) -> String { type == "audio" ? "aid" : "sid" }

    /// Negative → automatic choice, 0 → none.
    public static func trackValue(_ id: Int) -> String {
        if id < 0 { return "auto" }
        if id == 0 { return "no" }
        return String(id)
    }

    /// fill crops to fill the screen, stretch distorts, anything else (fit) shows the whole picture.
    public static func resize(_ mode: String) -> Resize {
        switch mode {
        case "fill": return Resize(keepAspect: "yes", panscan: 1.0)
        case "stretch": return Resize(keepAspect: "no", panscan: 0.0)
        default: return Resize(keepAspect: "yes", panscan: 0.0)
        }
    }

    public static func volume(_ value: Double) -> Double { min(max(value, 0.0), 100.0) }
    public static func speed(_ value: Double) -> Double { min(max(value, 0.25), 4.0) }
    public static func subtitleScale(_ value: Double) -> Double { min(max(value, 0.3), 3.0) }
}
