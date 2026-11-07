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

    public static func trackProperty(_ type: String) -> String { "" } // not implemented yet
    public static func trackValue(_ id: Int) -> String { "" } // not implemented yet
    public static func resize(_ mode: String) -> Resize { Resize(keepAspect: "", panscan: -1) } // not implemented yet
    public static func volume(_ value: Double) -> Double { -1 } // not implemented yet
    public static func speed(_ value: Double) -> Double { -1 } // not implemented yet
    public static func subtitleScale(_ value: Double) -> Double { -1 } // not implemented yet
}
