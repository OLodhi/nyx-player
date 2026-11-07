import XCTest
@testable import NyxPolicies

/// Port of Kotlin's MpvLogPolicyTest: what mpv's log lines say about a failed stream.
final class MpvLogPolicyTests: XCTestCase {
    func testHttpStatusOfRefusedStream() {
        XCTAssertEqual(MpvLogPolicy.httpErrorStatus("HTTP error 404 Not Found"), 404)
        XCTAssertEqual(MpvLogPolicy.httpErrorStatus("http: HTTP error 458 Unknown"), 458)
        XCTAssertNil(MpvLogPolicy.httpErrorStatus("Opening http://host.invalid:8080/live/u/p/1.ts"))
        XCTAssertEqual(MpvLogPolicy.serverReturnedStatus("Server returned 403 Forbidden (access denied)"), 403)
        XCTAssertNil(MpvLogPolicy.serverReturnedStatus("HTTP error 404 Not Found"))
        // Exactly three digits after the expected text
        XCTAssertNil(MpvLogPolicy.httpErrorStatus("HTTP error 40"))
    }

    func testFailedOpenRecognised() {
        XCTAssertTrue(MpvLogPolicy.isOpenFailure("Failed to open http://host.invalid/live/u/p/1.ts."))
        XCTAssertTrue(MpvLogPolicy.isOpenFailure("Opening failed or was aborted: http://host.invalid/movie/u/p/42.mkv"))
        XCTAssertTrue(MpvLogPolicy.isOpenFailure("Failed to recognize file format."))
        XCTAssertTrue(MpvLogPolicy.isOpenFailure("No such file or directory"))
        XCTAssertFalse(MpvLogPolicy.isOpenFailure("Opening done: http://host.invalid/live/u/p/1.ts"))
    }

    func testAudioDropping() {
        XCTAssertTrue(MpvLogPolicy.isAudioTrouble("Audio device underrun detected."))
        XCTAssertTrue(MpvLogPolicy.isAudioTrouble("Audio/Video desynchronisation detected!"))
        XCTAssertFalse(MpvLogPolicy.isAudioTrouble("AO: [audiotrack] 48000Hz stereo 2ch float"))
    }

    func testNoDecoderForVideo() {
        XCTAssertEqual(MpvLogPolicy.decoderFailureCodec("Failed to initialize a decoder for codec 'vc1'."), "vc1")
        // Message without a codec name: empty detail, the error is still reported
        XCTAssertEqual(MpvLogPolicy.decoderFailureCodec("Failed to initialize a decoder for codec"), "")
        XCTAssertNil(MpvLogPolicy.decoderFailureCodec("Using software decoding."))
    }
}
