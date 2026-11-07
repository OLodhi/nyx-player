import XCTest
@testable import NyxPolicies

/// Port of Kotlin's PlayerInputPolicyTest: what the page may ask the player to open or read.
final class PlayerInputPolicyTests: XCTestCase {
    func testNetworkStreamsAreAllowed() {
        for url in [
            "http://host.invalid:8080/live/u/p/1.ts",
            "https://host.invalid/movie/u/p/2.mkv",
            "HTTP://host.invalid/series/u/p/3.mp4",
            "rtmp://host.invalid/live/1",
            "rtmps://host.invalid/live/1",
            "rtsp://host.invalid/cam",
            "rtsps://host.invalid/cam",
        ] {
            XCTAssertTrue(PlayerInputPolicy.isAllowedStreamUrl(url), url)
        }
    }

    func testLocalFilesPseudoProtocolsAndHostlessUrlsAreRefused() {
        for url in [
            "file:///data/data/com.nyxplayer.app/databases/nyx.db",
            "/sdcard/Download/x.mkv",
            "fd://3",
            "lavfi://sine",
            "memory://abc",
            "av://lavfi:sine",
            "edl://a;b",
            "ytdl://x",
            "concat:http://host.invalid/a|file:///etc/hosts",
            " file:///etc/hosts",
            "http://",
            "http://host.invalid/live/1.ts\r\nX-Injected: 1",
            "http://host.invalid/\u{0000}",
            "://host.invalid/x",
            "",
        ] {
            XCTAssertFalse(PlayerInputPolicy.isAllowedStreamUrl(url), url)
        }
    }

    func testUserAgentWithoutLineBreaksAndBoundedLength() {
        XCTAssertTrue(PlayerInputPolicy.isAllowedUserAgent(nil))
        XCTAssertTrue(PlayerInputPolicy.isAllowedUserAgent("Nyx Player/0.8.0 (Android)"))
        XCTAssertTrue(PlayerInputPolicy.isAllowedUserAgent(String(repeating: "a", count: PlayerInputPolicy.maxUserAgentLength)))
        XCTAssertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\r\nX-Injected: 1"))
        XCTAssertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\nCookie: a=b"))
        XCTAssertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\u{0000}"))
        XCTAssertFalse(PlayerInputPolicy.isAllowedUserAgent(String(repeating: "a", count: PlayerInputPolicy.maxUserAgentLength + 1)))
    }

    func testOnlyInterfacePropertiesAreReadable() {
        for name in ["pause", "time-pos", "track-list", "fullscreen", "engine", "demuxer-cache-state"] {
            XCTAssertTrue(PlayerInputPolicy.isReadableProperty(name), name)
        }
        for name in ["tls-ca-file", "stream-open-filename", "path", "working-directory", "user-agent", ""] {
            XCTAssertFalse(PlayerInputPolicy.isReadableProperty(name), name)
        }
    }
}
