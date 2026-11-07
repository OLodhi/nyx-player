import XCTest
@testable import NyxPolicies

/// Port of Kotlin's PlaybackPolicyTest (7 tests), plus two iOS additions: GnuTLS's messages and
/// mpv's `start` option.
final class PlaybackPolicyTests: XCTestCase {
    private let mib: Int64 = 1024 * 1024
    private var gib: Int64 { 1024 * mib }

    func testFilmWithoutKnownDurationIsNotLive() {
        XCTAssertFalse(PlaybackPolicy.isLive(url: "http://host.invalid:8080/movie/u/p/42.mkv", duration: 0))
        XCTAssertFalse(PlaybackPolicy.isLive(url: "https://host.invalid/series/u/p/7.mp4", duration: 0))
        XCTAssertTrue(PlaybackPolicy.isLive(url: "http://host.invalid/live/u/p/1.ts", duration: 0))
        XCTAssertTrue(PlaybackPolicy.isLive(url: "http://host.invalid/u/p/1", duration: 0))
    }

    func testOnlyHttpsStreamsNeedCertificates() {
        XCTAssertTrue(PlaybackPolicy.isHttps("https://host.invalid/live/u/p/1.ts"))
        XCTAssertTrue(PlaybackPolicy.isHttps(" HTTPS://host.invalid/movie/u/p/2.mkv"))
        XCTAssertFalse(PlaybackPolicy.isHttps("http://host.invalid/live/u/p/1.ts"))
        XCTAssertFalse(PlaybackPolicy.isHttps("rtmp://host.invalid/live/1"))
    }

    func testKnownDurationMeansFilm() {
        XCTAssertFalse(PlaybackPolicy.isLive(url: "http://host.invalid/live/u/p/1.ts", duration: 5_400))
    }

    func testMovieOutsideFirstSegmentDoesNotCount() {
        XCTAssertTrue(PlaybackPolicy.isLive(url: "http://host.invalid/live/movie/1.ts", duration: 0))
        XCTAssertTrue(PlaybackPolicy.isLive(url: "http://host.invalid/live/1.ts?type=/movie/", duration: 0))
    }

    /// An http stream redirected to https with no certificates → "secure connection can't be checked"
    func testTlsFailureWithoutCertificatesGivesSecureConnectionMessage() {
        XCTAssertEqual(PlaybackPolicy.loadFailureCode(tlsFailed: true, certificatesAvailable: false), PlaybackPolicy.tlsCaUnavailable)
        // With certificates, a TLS failure (invalid certificate) stays a connection failure
        XCTAssertEqual(PlaybackPolicy.loadFailureCode(tlsFailed: true, certificatesAvailable: true), PlaybackPolicy.loadFailed)
        XCTAssertEqual(PlaybackPolicy.loadFailureCode(tlsFailed: false, certificatesAvailable: false), PlaybackPolicy.loadFailed)
        XCTAssertEqual(PlaybackPolicy.loadFailureCode(tlsFailed: false, certificatesAvailable: true), PlaybackPolicy.loadFailed)
        XCTAssertEqual(PlaybackPolicy.tlsCaUnavailable, "TLS_CA_UNAVAILABLE")
        XCTAssertEqual(PlaybackPolicy.loadFailed, "MPV_LOAD_FAILED")
    }

    func testTlsLayerMessagesRecognised() {
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("tls: No CA chain is set, but required to operate. Was the CA correctly set?"))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("tls: mbedtls_ssl_handshake returned -0x2700"))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("The certificate is not correctly signed by the trusted CA."))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("tls: TLS handshake was aborted by peer."))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("mbedtls_ssl_get_verify_result reported problems with the certificate verification"))
        // An address containing "tls" or "certificate" is not a TLS failure
        XCTAssertFalse(PlaybackPolicy.isTlsFailure("Opening http://tls.host.invalid/certificate/1.ts"))
        XCTAssertFalse(PlaybackPolicy.isTlsFailure("Failed to open http://host.invalid/live/u/p/1.ts."))
        XCTAssertFalse(PlaybackPolicy.isTlsFailure("HTTP error 404 Not Found"))
        XCTAssertFalse(PlaybackPolicy.isTlsFailure("Opening failed or was aborted: https://host.invalid/movie/u/p/42.mkv"))
    }

    func testSmallerCacheOnLowMemoryDevice() {
        let small = PlaybackPolicy.CacheSizes(forwardBytes: 32 * mib, backBytes: 8 * mib)
        let normal = PlaybackPolicy.CacheSizes(forwardBytes: 64 * mib, backBytes: 32 * mib)
        XCTAssertEqual(PlaybackPolicy.cacheSizes(totalMemoryBytes: 2 * gib, lowRamDevice: false), small)
        XCTAssertEqual(PlaybackPolicy.cacheSizes(totalMemoryBytes: 8 * gib, lowRamDevice: true), small)
        XCTAssertEqual(PlaybackPolicy.cacheSizes(totalMemoryBytes: 8 * gib, lowRamDevice: false), normal)
        // Unknown memory: as before
        XCTAssertEqual(PlaybackPolicy.cacheSizes(totalMemoryBytes: 0, lowRamDevice: false), normal)
    }

    /// iOS: FFmpeg's TLS is GnuTLS (MPVKit), whose verification messages differ from mbedTLS's
    func testGnuTlsVerificationFailureIsTls() {
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("tls: Peer certificate failed verification"))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("Unable to verify peer certificate: The certificate is NOT trusted."))
        XCTAssertTrue(PlaybackPolicy.isTlsFailure("The certificate's owner does not match hostname 'host.invalid'"))
    }

    /// mpv's `start`: "none" from the beginning, otherwise plain decimals (never 1.0E7)
    func testStartOptionUsesPlainDecimals() {
        XCTAssertEqual(PlaybackPolicy.startOption(0), "none")
        XCTAssertEqual(PlaybackPolicy.startOption(-3), "none")
        XCTAssertEqual(PlaybackPolicy.startOption(1e7), "10000000")
        XCTAssertEqual(PlaybackPolicy.startOption(12.5), "12.5")
    }
}
