package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvSubtitlePolicyTest {
    @Test
    fun `sous-titres sur TV, au-dessus de la bande rognée par la télé`() {
        // 22 (marge de mpv) + 5 % de 720 = 58, soit environ 8 % de la hauteur de l'écran
        assertEquals(58, TvSubtitlePolicy.subtitleMarginY(television = true))
    }

    @Test
    fun `sous-titres sur téléphone, réglage de mpv inchangé`() {
        assertNull(TvSubtitlePolicy.subtitleMarginY(television = false))
    }
}
