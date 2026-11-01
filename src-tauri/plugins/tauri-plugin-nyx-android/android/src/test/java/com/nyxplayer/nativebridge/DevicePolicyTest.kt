package com.nyxplayer.nativebridge

import com.nyxplayer.nativebridge.DevicePolicy.Capabilities
import com.nyxplayer.nativebridge.DevicePolicy.NetworkStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DevicePolicyTest {
    private val wifi = Capabilities(internet = true, notMetered = true, wifi = true, cellular = false, ethernet = false)

    @Test
    fun `portrait sur téléphone seulement`() {
        assertTrue(DevicePolicy.locksPortrait(smallestWidthDp = 411, television = false))
        assertFalse(DevicePolicy.locksPortrait(smallestWidthDp = 600, television = false))
        assertFalse(DevicePolicy.locksPortrait(smallestWidthDp = 800, television = false))
        // Une TV peut annoncer une petite largeur (Chromecast : 540 dp) : jamais de portrait
        assertFalse(DevicePolicy.locksPortrait(smallestWidthDp = 540, television = true))
    }

    @Test
    fun `aucun réseau`() {
        assertEquals(NetworkStatus(connected = false, metered = false, type = "none"), DevicePolicy.networkStatus(null))
    }

    @Test
    fun `types de connexion`() {
        assertEquals(NetworkStatus(true, false, "wifi"), DevicePolicy.networkStatus(wifi))
        val cellular = wifi.copy(notMetered = false, wifi = false, cellular = true)
        assertEquals(NetworkStatus(true, true, "cellular"), DevicePolicy.networkStatus(cellular))
        assertEquals("ethernet", DevicePolicy.networkStatus(wifi.copy(wifi = false, ethernet = true)).type)
        assertEquals("other", DevicePolicy.networkStatus(wifi.copy(wifi = false)).type)
        // Wi-Fi et données à la fois : Wi-Fi d'abord
        assertEquals("wifi", DevicePolicy.networkStatus(wifi.copy(cellular = true)).type)
    }

    @Test
    fun `données limitées suivent le réglage Android`() {
        // Partage de connexion d'un téléphone : Wi-Fi, mais limité
        assertTrue(DevicePolicy.networkStatus(wifi.copy(notMetered = false)).metered)
        // Réseau présent sans accès à Internet : ni connecté, ni limité
        val noInternet = DevicePolicy.networkStatus(wifi.copy(internet = false, notMetered = false))
        assertFalse(noInternet.connected)
        assertFalse(noInternet.metered)
        assertEquals("wifi", noInternet.type)
    }
}
