package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Test

class PlayerSettingsTest {
    @Test
    fun `piste son ou sous-titres`() {
        assertEquals("aid", PlayerSettings.trackProperty("audio"))
        assertEquals("sid", PlayerSettings.trackProperty("sub"))
        // Tout autre type vise les sous-titres, comme avant
        assertEquals("sid", PlayerSettings.trackProperty("video"))
    }

    @Test
    fun `numéro de piste traduit pour mpv`() {
        // Négatif : choix automatique (chaîne en direct après un film)
        assertEquals("auto", PlayerSettings.trackValue(-1))
        assertEquals("no", PlayerSettings.trackValue(0))
        assertEquals("3", PlayerSettings.trackValue(3))
    }

    @Test
    fun `formats d'image`() {
        assertEquals(PlayerSettings.Resize("yes", 1.0), PlayerSettings.resize("fill"))
        assertEquals(PlayerSettings.Resize("no", 0.0), PlayerSettings.resize("stretch"))
        assertEquals(PlayerSettings.Resize("yes", 0.0), PlayerSettings.resize("fit"))
        // Mode inconnu : image entière, sans rognage ni déformation
        assertEquals(PlayerSettings.Resize("yes", 0.0), PlayerSettings.resize("zoom"))
    }

    @Test
    fun `volume, vitesse et taille des sous-titres bornés`() {
        assertEquals(0.0, PlayerSettings.volume(-5.0), 0.0)
        assertEquals(42.0, PlayerSettings.volume(42.0), 0.0)
        assertEquals(100.0, PlayerSettings.volume(150.0), 0.0)
        assertEquals(0.25, PlayerSettings.speed(0.1), 0.0)
        assertEquals(1.5, PlayerSettings.speed(1.5), 0.0)
        assertEquals(4.0, PlayerSettings.speed(8.0), 0.0)
        assertEquals(0.3, PlayerSettings.subtitleScale(0.0), 0.0)
        assertEquals(1.2, PlayerSettings.subtitleScale(1.2), 0.0)
        assertEquals(3.0, PlayerSettings.subtitleScale(5.0), 0.0)
    }
}
