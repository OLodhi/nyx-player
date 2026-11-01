package com.nyxplayer.nativebridge

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlayerInputPolicyTest {
    @Test
    fun `les flux réseau sont acceptés`() {
        for (url in listOf(
            "http://host.invalid:8080/live/u/p/1.ts",
            "https://host.invalid/movie/u/p/2.mkv",
            "HTTP://host.invalid/series/u/p/3.mp4",
            "rtmp://host.invalid/live/1",
            "rtmps://host.invalid/live/1",
            "rtsp://host.invalid/cam",
            "rtsps://host.invalid/cam",
        )) assertTrue(url, PlayerInputPolicy.isAllowedStreamUrl(url))
    }

    @Test
    fun `fichiers locaux, pseudo-protocoles et adresses sans hôte sont refusés`() {
        for (url in listOf(
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
            "http://host.invalid/\u0000",
            "://host.invalid/x",
            "",
        )) assertFalse(url, PlayerInputPolicy.isAllowedStreamUrl(url))
    }

    @Test
    fun `userAgent sans retour à la ligne et de longueur bornée`() {
        assertTrue(PlayerInputPolicy.isAllowedUserAgent(null))
        assertTrue(PlayerInputPolicy.isAllowedUserAgent("Nyx Player/0.8.0 (Android)"))
        assertTrue(PlayerInputPolicy.isAllowedUserAgent("a".repeat(PlayerInputPolicy.MAX_USER_AGENT_LENGTH)))
        assertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\r\nX-Injected: 1"))
        assertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\nCookie: a=b"))
        assertFalse(PlayerInputPolicy.isAllowedUserAgent("Nyx\u0000"))
        assertFalse(PlayerInputPolicy.isAllowedUserAgent("a".repeat(PlayerInputPolicy.MAX_USER_AGENT_LENGTH + 1)))
    }

    @Test
    fun `seules les propriétés de l'interface se lisent`() {
        for (name in listOf("pause", "time-pos", "track-list", "fullscreen", "engine", "demuxer-cache-state")) {
            assertTrue(name, PlayerInputPolicy.isReadableProperty(name))
        }
        for (name in listOf("tls-ca-file", "stream-open-filename", "path", "working-directory", "user-agent", "")) {
            assertFalse(name, PlayerInputPolicy.isReadableProperty(name))
        }
    }
}
