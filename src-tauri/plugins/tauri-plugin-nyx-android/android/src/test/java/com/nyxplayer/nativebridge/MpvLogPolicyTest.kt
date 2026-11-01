package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MpvLogPolicyTest {
    @Test
    fun `code HTTP d'un flux refusé`() {
        assertEquals(404, MpvLogPolicy.httpErrorStatus("HTTP error 404 Not Found"))
        assertEquals(458, MpvLogPolicy.httpErrorStatus("http: HTTP error 458 Unknown"))
        assertNull(MpvLogPolicy.httpErrorStatus("Opening http://host.invalid:8080/live/u/p/1.ts"))
        assertEquals(403, MpvLogPolicy.serverReturnedStatus("Server returned 403 Forbidden (access denied)"))
        assertNull(MpvLogPolicy.serverReturnedStatus("HTTP error 404 Not Found"))
        // Trois chiffres exactement après le texte attendu
        assertNull(MpvLogPolicy.httpErrorStatus("HTTP error 40"))
    }

    @Test
    fun `ouverture ratée reconnue`() {
        assertTrue(MpvLogPolicy.isOpenFailure("Failed to open http://host.invalid/live/u/p/1.ts."))
        assertTrue(MpvLogPolicy.isOpenFailure("Opening failed or was aborted: http://host.invalid/movie/u/p/42.mkv"))
        assertTrue(MpvLogPolicy.isOpenFailure("Failed to recognize file format."))
        assertTrue(MpvLogPolicy.isOpenFailure("No such file or directory"))
        assertFalse(MpvLogPolicy.isOpenFailure("Opening done: http://host.invalid/live/u/p/1.ts"))
    }

    @Test
    fun `son qui décroche`() {
        assertTrue(MpvLogPolicy.isAudioTrouble("Audio device underrun detected."))
        assertTrue(MpvLogPolicy.isAudioTrouble("Audio/Video desynchronisation detected!"))
        assertFalse(MpvLogPolicy.isAudioTrouble("AO: [audiotrack] 48000Hz stereo 2ch float"))
    }

    @Test
    fun `aucun décodeur pour la vidéo`() {
        assertEquals("vc1", MpvLogPolicy.decoderFailureCodec("Failed to initialize a decoder for codec 'vc1'."))
        // Message sans nom de codec : détail vide, l'erreur reste signalée
        assertEquals("", MpvLogPolicy.decoderFailureCodec("Failed to initialize a decoder for codec"))
        assertNull(MpvLogPolicy.decoderFailureCodec("Using software decoding."))
    }
}
