/// What the plugin knows about the current connection path (from NWPathMonitor).
public struct NetworkPathFacts: Equatable {
    public var satisfied: Bool
    public var expensive: Bool
    public var constrained: Bool
    public var wifi: Bool
    public var cellular: Bool
    public var wired: Bool

    public init(satisfied: Bool, expensive: Bool, constrained: Bool, wifi: Bool, cellular: Bool, wired: Bool) {
        self.satisfied = satisfied
        self.expensive = expensive
        self.constrained = constrained
        self.wifi = wifi
        self.cellular = cellular
        self.wired = wired
    }
}

/// The `network_status` answer: `type` is wifi, cellular, ethernet, other or none.
public struct NetworkStatusValue: Equatable {
    public let connected: Bool
    public let metered: Bool
    public let type: String
}

/// Mirrors Kotlin's DevicePolicy.networkStatus. Metered = expensive (cellular, personal hotspot) or
/// constrained (Low Data Mode); without a connection, nothing is metered.
/// Not `networkStatus`: inside NyxPlugin that name is the `@objc` command.
public func networkStatusValue(_ facts: NetworkPathFacts?) -> NetworkStatusValue {
    guard let facts else { return NetworkStatusValue(connected: false, metered: false, type: "none") }
    let connected = facts.satisfied
    let type: String
    if facts.wifi {
        type = "wifi"
    } else if facts.cellular {
        type = "cellular"
    } else if facts.wired {
        type = "ethernet"
    } else {
        type = connected ? "other" : "none"
    }
    return NetworkStatusValue(
        connected: connected,
        metered: connected && (facts.expensive || facts.constrained),
        type: type)
}
