import XCTest
@testable import NyxPolicies

/// Port of Kotlin's LogRepeatFilterTest: a corrupt stream repeats the same message many times a second.
final class LogRepeatFilterTests: XCTestCase {
    func testSameMessageHiddenDuringWindowThenCounted() {
        let filter = LogRepeatFilter()
        XCTAssertEqual(filter.admit(prefix: "vd", line: "Could not find ref with POC 12", nowMs: 0), "vd: Could not find ref with POC 12")
        // Only the digits change: same message
        XCTAssertNil(filter.admit(prefix: "vd", line: "Could not find ref with POC 13", nowMs: 500))
        XCTAssertNil(filter.admit(prefix: "vd", line: "Could not find ref with POC 14", nowMs: 1_999))
        XCTAssertEqual(
            filter.admit(prefix: "vd", line: "Could not find ref with POC 15", nowMs: 2_000),
            "vd: Could not find ref with POC 15 (+2 identiques)")
        // The count starts again after each logged line
        XCTAssertEqual(filter.admit(prefix: "vd", line: "Could not find ref with POC 16", nowMs: 4_000), "vd: Could not find ref with POC 16")
    }

    func testDifferentPrefixOrTextNotGrouped() {
        let filter = LogRepeatFilter()
        XCTAssertEqual(filter.admit(prefix: "vd", line: "decoding error", nowMs: 0), "vd: decoding error")
        XCTAssertEqual(filter.admit(prefix: "ad", line: "decoding error", nowMs: 10), "ad: decoding error")
        XCTAssertEqual(filter.admit(prefix: "vd", line: "other error", nowMs: 20), "vd: other error")
    }

    func testTableDoesNotGrowForever() {
        let filter = LogRepeatFilter(windowMs: 2_000, maxKeys: 2)
        _ = filter.admit(prefix: "vd", line: "a", nowMs: 0)
        _ = filter.admit(prefix: "vd", line: "b", nowMs: 0)
        _ = filter.admit(prefix: "vd", line: "c", nowMs: 0)
        // Table full (3 > 2): cleared before adding "d", so "a" is forgotten and logged again at once
        _ = filter.admit(prefix: "vd", line: "d", nowMs: 0)
        XCTAssertEqual(filter.admit(prefix: "vd", line: "a", nowMs: 1), "vd: a")
    }
}
