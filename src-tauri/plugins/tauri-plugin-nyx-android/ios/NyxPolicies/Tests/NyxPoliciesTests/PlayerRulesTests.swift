import Foundation
import XCTest
@testable import NyxPolicies

/// iOS-only rules (no Kotlin counterpart): property conversion for events, orientation masks, the
/// rotation debounce (MPVKit doesn't follow the layer size), the resume point after the background,
/// and the CA list as PEM for GnuTLS.
final class PropertyValueTests: XCTestCase {
    func testJsonObjectAndArrayAreKeptAsJson() {
        XCTAssertEqual(PropertyValue.convert("{\"w\":1920}", name: "video-params"), .json("{\"w\":1920}"))
        XCTAssertEqual(PropertyValue.convert("[{\"id\":1}]", name: "track-list"), .json("[{\"id\":1}]"))
    }

    func testInvalidJsonStaysString() {
        XCTAssertEqual(PropertyValue.convert("{oops", name: "video-params"), .string("{oops"))
    }

    func testFlagsAreBooleans() {
        XCTAssertEqual(PropertyValue.convert("yes", name: "pause"), .bool(true))
        XCTAssertEqual(PropertyValue.convert("no", name: "eof-reached"), .bool(false))
    }

    func testTracksAreNumbersOrFalse() {
        XCTAssertEqual(PropertyValue.convert("2", name: "aid"), .int(2))
        XCTAssertEqual(PropertyValue.convert("auto", name: "aid"), .bool(false))
        XCTAssertEqual(PropertyValue.convert("no", name: "sid"), .bool(false))
    }

    func testNumbersStringsAndAbsent() {
        XCTAssertEqual(PropertyValue.convert("12.5", name: "time-pos"), .double(12.5))
        XCTAssertEqual(PropertyValue.convert("h264", name: "video-codec"), .string("h264"))
        // A string property that looks like a number stays a string
        XCTAssertEqual(PropertyValue.convert("123", name: "media-title"), .string("123"))
        XCTAssertEqual(PropertyValue.convert(nil, name: "duration"), .null)
    }
}

final class OrientationPolicyTests: XCTestCase {
    func testPhoneEverydayIsPortrait() {
        XCTAssertEqual(OrientationPolicy.everydayMask(isPhone: true), OrientationPolicy.portrait)
    }

    func testPadEverydayIsFree() {
        XCTAssertEqual(OrientationPolicy.everydayMask(isPhone: false), OrientationPolicy.all)
    }

    func testPhonePlayerIsLandscape() {
        XCTAssertEqual(OrientationPolicy.playerMask(isPhone: true), OrientationPolicy.landscape)
    }

    func testPadPlayerLeavesOrientationFree() {
        XCTAssertNil(OrientationPolicy.playerMask(isPhone: false))
    }
}

final class ResizeDebouncerTests: XCTestCase {
    func testNotDueBeforeQuietPeriod() {
        let debouncer = ResizeDebouncer(quietMs: 250)
        debouncer.sizeChanged(nowMs: 0)
        XCTAssertFalse(debouncer.due(nowMs: 249))
    }

    func testDueOnceAfterQuietPeriod() {
        let debouncer = ResizeDebouncer(quietMs: 250)
        debouncer.sizeChanged(nowMs: 0)
        XCTAssertTrue(debouncer.due(nowMs: 250))
        XCTAssertFalse(debouncer.due(nowMs: 400))
    }

    func testNewChangeRestartsWait() {
        let debouncer = ResizeDebouncer(quietMs: 250)
        debouncer.sizeChanged(nowMs: 0)
        debouncer.sizeChanged(nowMs: 200)
        XCTAssertFalse(debouncer.due(nowMs: 300))
        XCTAssertTrue(debouncer.due(nowMs: 450))
    }
}

final class LifecyclePolicyTests: XCTestCase {
    func testLiveResumesAtLiveEdge() {
        let point = LifecyclePolicy.resumePoint(url: "http://host.invalid/live/u/p/1.ts", duration: 0, timePos: 840, paused: false)
        XCTAssertEqual(point.start, 0)
    }

    func testFilmResumesWhereItWas() {
        let point = LifecyclePolicy.resumePoint(url: "http://host.invalid/movie/u/p/42.mkv", duration: 5_400, timePos: 1_234.5, paused: false)
        XCTAssertEqual(point.start, 1_234.5)
        XCTAssertEqual(point.url, "http://host.invalid/movie/u/p/42.mkv")
    }

    func testPauseStateKept() {
        let point = LifecyclePolicy.resumePoint(url: "http://host.invalid/movie/u/p/42.mkv", duration: 5_400, timePos: 60, paused: true)
        XCTAssertTrue(point.paused)
    }
}

final class PemBundleTests: XCTestCase {
    private let first = Data((0..<200).map { UInt8($0) })
    private let second = Data([0x30, 0x82, 0x01, 0x0a])

    func testOneBlockPerCertificate() {
        let pem = PemBundle.pem(fromDER: [first, second])
        XCTAssertEqual(pem.components(separatedBy: "-----BEGIN CERTIFICATE-----\n").count - 1, 2)
        XCTAssertEqual(pem.components(separatedBy: "-----END CERTIFICATE-----\n").count - 1, 2)
    }

    func testLinesAreAtMost64Characters() {
        for line in PemBundle.pem(fromDER: [first]).split(separator: "\n") {
            XCTAssertLessThanOrEqual(line.count, 64)
        }
        XCTAssertFalse(PemBundle.pem(fromDER: [first]).contains("\r"))
    }

    func testBase64RoundTrips() {
        let body = PemBundle.pem(fromDER: [first])
            .split(separator: "\n")
            .filter { !$0.hasPrefix("-----") }
            .joined()
        XCTAssertEqual(Data(base64Encoded: body), first)
    }
}
