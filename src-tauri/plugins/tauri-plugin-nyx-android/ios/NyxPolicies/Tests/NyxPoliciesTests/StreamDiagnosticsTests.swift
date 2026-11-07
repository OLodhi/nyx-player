import XCTest
@testable import NyxPolicies

/// Port of Kotlin's StreamDiagnosticsTest: player logs hold no stream address, server name or IP.
final class StreamDiagnosticsTests: XCTestCase {
    func testStreamAddressIsMasked() {
        XCTAssertEqual(
            StreamDiagnostics.redact("Opening http://tv.example.invalid:8080/live/jean/S3cret/1.ts failed"),
            "Opening <url> failed")
    }

    func testXtreamPathWithoutAddressIsMasked() {
        XCTAssertEqual(StreamDiagnostics.redact("Opening /live/jean/S3cret/1.ts failed"), "Opening /live/***/***/1.ts failed")
        XCTAssertEqual(StreamDiagnostics.redact("'/MOVIE/jean/S3cret/2.mkv': 404"), "'/MOVIE/***/***/2.mkv': 404")
        XCTAssertEqual(StreamDiagnostics.redact("/hls/jean/S3cret/3.m3u8"), "/hls/***/***/3.m3u8")
        XCTAssertEqual(StreamDiagnostics.redact("/timeshift/jean/S3cret/60/4.ts"), "/timeshift/***/***/60/4.ts")
        XCTAssertFalse(StreamDiagnostics.redact("GET /play/jean/S3cret/5").contains("S3cret"))
    }

    func testServerNameQuotedAloneByFfmpegIsMasked() {
        XCTAssertEqual(
            StreamDiagnostics.redact("tcp: Failed to resolve hostname tv.example.invalid: Name does not resolve"),
            "tcp: Failed to resolve hostname <host>: Name does not resolve")
    }

    func testIpAddressAndPortAreMasked() {
        XCTAssertEqual(StreamDiagnostics.redact("Connection to 185.12.4.33:8080 failed"), "Connection to <ip> failed")
    }

    func testIpv6AddressAndHostHeaderAreMasked() {
        XCTAssertEqual(StreamDiagnostics.redact("Connection to [2001:db8::1]:8080 failed"), "Connection to <ip> failed")
        XCTAssertEqual(StreamDiagnostics.redact("addr fe80::1 x"), "addr <ip> x")
        XCTAssertEqual(StreamDiagnostics.redact("Host: tv.example.invalid"), "Host: <host>")
    }

    func testUsefulDiagnosticsStayReadable() {
        XCTAssertEqual(StreamDiagnostics.redact("host is unreachable"), "host is unreachable")
        XCTAssertEqual(StreamDiagnostics.redact("time 00:01:23.456"), "time 00:01:23.456")
        XCTAssertEqual(StreamDiagnostics.redact("demuxer cache 50+25 MiB (RAM 2048 MiB)"), "demuxer cache 50+25 MiB (RAM 2048 MiB)")
        XCTAssertEqual(StreamDiagnostics.redact("load failed http=458"), "load failed http=458")
        XCTAssertFalse(StreamDiagnostics.redact("hostname=tv.example.invalid").contains("example"))
    }
}
