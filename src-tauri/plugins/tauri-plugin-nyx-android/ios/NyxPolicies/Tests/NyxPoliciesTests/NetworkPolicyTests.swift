import XCTest
@testable import NyxPolicies

/// Connection path → `network_status`, mirroring Kotlin's DevicePolicy.networkStatus: the TV guide
/// (about 205 MB) must not download on metered mobile data.
final class NetworkPolicyTests: XCTestCase {
    private func facts(
        satisfied: Bool = true, expensive: Bool = false, constrained: Bool = false,
        wifi: Bool = false, cellular: Bool = false, wired: Bool = false
    ) -> NetworkPathFacts {
        NetworkPathFacts(
            satisfied: satisfied, expensive: expensive, constrained: constrained,
            wifi: wifi, cellular: cellular, wired: wired)
    }

    private func status(_ connected: Bool, _ metered: Bool, _ type: String) -> NetworkStatusValue {
        NetworkStatusValue(connected: connected, metered: metered, type: type)
    }

    func testNoPathIsNone() {
        XCTAssertEqual(networkStatusValue(nil), status(false, false, "none"))
    }

    func testWifiUnmetered() {
        XCTAssertEqual(networkStatusValue(facts(wifi: true)), status(true, false, "wifi"))
    }

    func testCellularExpensiveIsMetered() {
        XCTAssertEqual(networkStatusValue(facts(expensive: true, cellular: true)), status(true, true, "cellular"))
    }

    /// Low Data Mode on a Wi-Fi network: treated as metered.
    func testLowDataModeIsMetered() {
        XCTAssertEqual(networkStatusValue(facts(constrained: true, wifi: true)), status(true, true, "wifi"))
    }

    func testWiredIsEthernet() {
        XCTAssertEqual(networkStatusValue(facts(wired: true)), status(true, false, "ethernet"))
    }

    func testSatisfiedWithoutKnownInterfaceIsOther() {
        XCTAssertEqual(networkStatusValue(facts()), status(true, false, "other"))
    }

    /// Without a connection, nothing is "metered" (as on Android).
    func testUnsatisfiedIsNotConnectedNotMetered() {
        XCTAssertEqual(
            networkStatusValue(facts(satisfied: false, expensive: true, wifi: true)),
            status(false, false, "wifi"))
    }

    func testUnsatisfiedWithoutInterfaceIsNone() {
        XCTAssertEqual(networkStatusValue(facts(satisfied: false)), status(false, false, "none"))
    }
}
