import Foundation
import Network
import NyxPolicies

/// The connection type for `network_status` (design §5.2): one NWPathMonitor, started when the
/// plugin loads. Used to keep the TV guide download (about 205 MB) off metered mobile data.
final class NetworkMonitor {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.nyxplayer.network-monitor")
    private let latest = FirstValue<NetworkPathFacts>()
    private var started = false

    /// Starts the monitor once: NyxPlugin.load(webview:) may run again for another webview, and an
    /// NWPathMonitor must not be started twice. A plain flag, not thread-safe: only load(webview:)
    /// calls this, on the main thread.
    func start() {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [latest] path in
            latest.publish(NetworkPathFacts(
                satisfied: path.status == .satisfied,
                expensive: path.isExpensive,
                constrained: path.isConstrained,
                wifi: path.usesInterfaceType(.wifi),
                cellular: path.usesInterfaceType(.cellular),
                wired: path.usesInterfaceType(.wiredEthernet)))
        }
        monitor.start(queue: queue)
    }

    /// Right after launch the monitor may not have reported yet: wait up to 1 s for its first
    /// reading rather than answer "not connected". Still no reading then: nil (the command rejects).
    func status(_ completion: @escaping (NetworkStatusValue?) -> Void) {
        latest.get(timeout: 1, queue: queue) { facts in
            completion(networkStatusValue(facts))
        }
    }
}
