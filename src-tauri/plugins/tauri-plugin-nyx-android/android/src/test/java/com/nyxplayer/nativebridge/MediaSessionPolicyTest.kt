package com.nyxplayer.nativebridge

import android.media.session.PlaybackState
import com.nyxplayer.nativebridge.MediaSessionPolicy.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Assistant, casque, télécommande : ce que la MediaSession annonce et comment elle se traduit. */
class MediaSessionPolicyTest {
    private fun has(actions: Long, action: Long) = actions and action != 0L

    @Test
    fun `le type suit l'ouverture puis la durée`() {
        val live = "http://host.invalid/live/u/p/1.ts"
        assertEquals(Kind.OPENING, MediaSessionPolicy.kind(fileLoaded = false, duration = 5_400.0, url = live))
        assertEquals(Kind.VOD, MediaSessionPolicy.kind(fileLoaded = true, duration = 5_400.0, url = live))
        assertEquals(Kind.LIVE, MediaSessionPolicy.kind(fileLoaded = true, duration = 0.0, url = live))
    }

    // Un film sans durée annoncée proposait « chaîne suivante » au casque et à l'Assistant
    @Test
    fun `un film ou un épisode sans durée reste un film`() {
        val movie = "http://host.invalid:8080/movie/u/p/42.mkv"
        val episode = "https://host.invalid/series/u/p/7.mp4"
        assertEquals(Kind.VOD, MediaSessionPolicy.kind(fileLoaded = true, duration = 0.0, url = movie))
        assertEquals(Kind.VOD, MediaSessionPolicy.kind(fileLoaded = true, duration = 0.0, url = episode))
        assertEquals(Kind.OPENING, MediaSessionPolicy.kind(fileLoaded = false, duration = 0.0, url = movie))
        val actions = MediaSessionPolicy.actions(MediaSessionPolicy.kind(fileLoaded = true, duration = 0.0, url = movie))
        assertTrue(has(actions, PlaybackState.ACTION_FAST_FORWARD))
        assertTrue(!has(actions, PlaybackState.ACTION_SKIP_TO_NEXT))
    }

    @Test
    fun `lecture, pause et arrêt sont toujours annoncés`() {
        for (kind in Kind.values()) {
            val actions = MediaSessionPolicy.actions(kind)
            assertTrue(has(actions, PlaybackState.ACTION_PLAY))
            assertTrue(has(actions, PlaybackState.ACTION_PAUSE))
            assertTrue(has(actions, PlaybackState.ACTION_PLAY_PAUSE))
            assertTrue(has(actions, PlaybackState.ACTION_STOP))
        }
    }

    @Test
    fun `un film se déplace, un direct change de chaîne`() {
        val vod = MediaSessionPolicy.actions(Kind.VOD)
        assertTrue(has(vod, PlaybackState.ACTION_SEEK_TO))
        assertTrue(has(vod, PlaybackState.ACTION_FAST_FORWARD))
        assertTrue(has(vod, PlaybackState.ACTION_REWIND))
        assertTrue(!has(vod, PlaybackState.ACTION_SKIP_TO_NEXT))

        val live = MediaSessionPolicy.actions(Kind.LIVE)
        assertTrue(has(live, PlaybackState.ACTION_SKIP_TO_NEXT))
        assertTrue(has(live, PlaybackState.ACTION_SKIP_TO_PREVIOUS))
        assertTrue(!has(live, PlaybackState.ACTION_SEEK_TO))
        assertTrue(!has(live, PlaybackState.ACTION_FAST_FORWARD))

        val opening = MediaSessionPolicy.actions(Kind.OPENING)
        assertTrue(!has(opening, PlaybackState.ACTION_SEEK_TO))
        assertTrue(!has(opening, PlaybackState.ACTION_SKIP_TO_NEXT))
    }

    @Test
    fun `une mise en tampon reste « en lecture » pour que le casque puisse mettre en pause`() {
        assertEquals(PlaybackState.STATE_PAUSED, MediaSessionPolicy.state(paused = true))
        assertEquals(PlaybackState.STATE_PLAYING, MediaSessionPolicy.state(paused = false))
    }

    @Test
    fun `la position n'avance ni en pause ni en mise en tampon`() {
        assertEquals(0f, MediaSessionPolicy.speed(paused = true, buffering = false, speed = 1.0), 0f)
        assertEquals(0f, MediaSessionPolicy.speed(paused = false, buffering = true, speed = 1.0), 0f)
        assertEquals(1.5f, MediaSessionPolicy.speed(paused = false, buffering = false, speed = 1.5), 0f)
    }

    @Test
    fun `la position n'est annoncée que pour un film`() {
        assertEquals(754_500L, MediaSessionPolicy.positionMs(Kind.VOD, 754.5))
        assertEquals(0L, MediaSessionPolicy.positionMs(Kind.VOD, -2.0))
        assertEquals(PlaybackState.PLAYBACK_POSITION_UNKNOWN, MediaSessionPolicy.positionMs(Kind.LIVE, 754.5))
        assertEquals(PlaybackState.PLAYBACK_POSITION_UNKNOWN, MediaSessionPolicy.positionMs(Kind.OPENING, 0.0))
    }

    @Test
    fun `aller à reste dans le film`() {
        assertEquals(120.0, MediaSessionPolicy.seekTarget(Kind.VOD, 120_000, duration = 5_400.0)!!, 0.0)
        assertEquals(0.0, MediaSessionPolicy.seekTarget(Kind.VOD, -30_000, duration = 5_400.0)!!, 0.0)
        assertEquals(5_399.0, MediaSessionPolicy.seekTarget(Kind.VOD, 9_000_000, duration = 5_400.0)!!, 0.0)
    }

    @Test
    fun `aller à dans un film sans durée ne recule pas avant le début`() {
        assertEquals(120.0, MediaSessionPolicy.seekTarget(Kind.VOD, 120_000, duration = 0.0)!!, 0.0)
        assertEquals(0.0, MediaSessionPolicy.seekTarget(Kind.VOD, -30_000, duration = 0.0)!!, 0.0)
    }

    @Test
    fun `aller à ne fait rien en direct ni pendant l'ouverture`() {
        assertNull(MediaSessionPolicy.seekTarget(Kind.LIVE, 120_000, duration = 0.0))
        assertNull(MediaSessionPolicy.seekTarget(Kind.OPENING, 120_000, duration = 5_400.0))
    }
}
