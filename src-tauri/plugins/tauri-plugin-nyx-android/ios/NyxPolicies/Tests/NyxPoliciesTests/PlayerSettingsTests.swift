import XCTest
@testable import NyxPolicies

/// Port of Kotlin's PlayerSettingsTest: tracks, picture format, clamps.
final class PlayerSettingsTests: XCTestCase {
    func testAudioOrSubtitleTrack() {
        XCTAssertEqual(PlayerSettings.trackProperty("audio"), "aid")
        XCTAssertEqual(PlayerSettings.trackProperty("sub"), "sid")
        // Any other type targets subtitles, as before
        XCTAssertEqual(PlayerSettings.trackProperty("video"), "sid")
    }

    func testTrackNumberTranslatedForMpv() {
        // Negative: automatic choice (a live channel after a film)
        XCTAssertEqual(PlayerSettings.trackValue(-1), "auto")
        XCTAssertEqual(PlayerSettings.trackValue(0), "no")
        XCTAssertEqual(PlayerSettings.trackValue(3), "3")
    }

    func testPictureFormats() {
        XCTAssertEqual(PlayerSettings.resize("fill"), PlayerSettings.Resize(keepAspect: "yes", panscan: 1.0))
        XCTAssertEqual(PlayerSettings.resize("stretch"), PlayerSettings.Resize(keepAspect: "no", panscan: 0.0))
        XCTAssertEqual(PlayerSettings.resize("fit"), PlayerSettings.Resize(keepAspect: "yes", panscan: 0.0))
        // Unknown mode: the whole picture, neither cropped nor distorted
        XCTAssertEqual(PlayerSettings.resize("zoom"), PlayerSettings.Resize(keepAspect: "yes", panscan: 0.0))
    }

    func testVolumeSpeedAndSubtitleScaleClamped() {
        XCTAssertEqual(PlayerSettings.volume(-5.0), 0.0)
        XCTAssertEqual(PlayerSettings.volume(42.0), 42.0)
        XCTAssertEqual(PlayerSettings.volume(150.0), 100.0)
        XCTAssertEqual(PlayerSettings.speed(0.1), 0.25)
        XCTAssertEqual(PlayerSettings.speed(1.5), 1.5)
        XCTAssertEqual(PlayerSettings.speed(8.0), 4.0)
        XCTAssertEqual(PlayerSettings.subtitleScale(0.0), 0.3)
        XCTAssertEqual(PlayerSettings.subtitleScale(1.2), 1.2)
        XCTAssertEqual(PlayerSettings.subtitleScale(5.0), 3.0)
    }
}
