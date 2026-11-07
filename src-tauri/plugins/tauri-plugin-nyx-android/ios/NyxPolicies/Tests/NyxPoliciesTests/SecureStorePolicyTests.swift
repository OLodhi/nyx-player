import Foundation
import Security
import XCTest
@testable import NyxPolicies

/// Keychain result → what the plugin answers. JS relies on the difference between `null` (really
/// absent) and a reject (temporarily unavailable, try again).
final class SecureStorePolicyTests: XCTestCase {
    func testReadSuccessReturnsValue() {
        XCTAssertEqual(secureReadOutcome(status: errSecSuccess, data: Data("abc".utf8)), .value("abc"))
    }

    func testReadNotFoundIsAbsent() {
        XCTAssertEqual(secureReadOutcome(status: errSecItemNotFound, data: nil), .absent)
    }

    /// Before the first unlock (app started in the background on a locked phone): reject, so JS
    /// retries instead of deciding there are no credentials.
    func testReadInteractionNotAllowedFails() {
        XCTAssertEqual(
            secureReadOutcome(status: errSecInteractionNotAllowed, data: nil),
            .failed(errSecInteractionNotAllowed))
    }

    func testReadNonUtf8IsCorrupt() {
        XCTAssertEqual(secureReadOutcome(status: errSecSuccess, data: Data([0xff, 0xfe])), .corrupt)
    }

    func testReadSuccessWithoutDataIsCorrupt() {
        XCTAssertEqual(secureReadOutcome(status: errSecSuccess, data: nil), .corrupt)
    }

    func testWriteSuccessAndFailure() {
        XCTAssertEqual(secureWriteOutcome(status: errSecSuccess), .done)
        XCTAssertEqual(secureWriteOutcome(status: errSecDuplicateItem), .failed(errSecDuplicateItem))
    }

    func testDeleteNotFoundIsDone() {
        XCTAssertEqual(secureDeleteOutcome(status: errSecSuccess), .done)
        XCTAssertEqual(secureDeleteOutcome(status: errSecItemNotFound), .done)
        XCTAssertEqual(
            secureDeleteOutcome(status: errSecInteractionNotAllowed),
            .failed(errSecInteractionNotAllowed))
    }

    /// Never the key or the value: they hold credentials and session tokens.
    func testFailureMessageCarriesOnlyOperationAndStatus() {
        XCTAssertEqual(
            secureFailureMessage("secure_get", status: errSecInteractionNotAllowed),
            "secure_get failed (OSStatus -25308)")
    }
}
