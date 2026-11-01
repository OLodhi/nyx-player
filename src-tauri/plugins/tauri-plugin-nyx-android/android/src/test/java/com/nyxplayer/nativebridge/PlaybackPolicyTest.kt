package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackPolicyTest {
    private val mib = 1024L * 1024L
    private val gib = 1024L * mib

    @Test
    fun `un film sans durée connue n'est pas un direct`() {
        assertFalse(PlaybackPolicy.isLive("http://host.invalid:8080/movie/u/p/42.mkv", 0.0))
        assertFalse(PlaybackPolicy.isLive("https://host.invalid/series/u/p/7.mp4", 0.0))
        assertTrue(PlaybackPolicy.isLive("http://host.invalid/live/u/p/1.ts", 0.0))
        assertTrue(PlaybackPolicy.isLive("http://host.invalid/u/p/1", 0.0))
    }

    @Test
    fun `seuls les flux https demandent des certificats`() {
        assertTrue(PlaybackPolicy.isHttps("https://host.invalid/live/u/p/1.ts"))
        assertTrue(PlaybackPolicy.isHttps(" HTTPS://host.invalid/movie/u/p/2.mkv"))
        assertFalse(PlaybackPolicy.isHttps("http://host.invalid/live/u/p/1.ts"))
        assertFalse(PlaybackPolicy.isHttps("rtmp://host.invalid/live/1"))
    }

    @Test
    fun `une durée connue suffit à dire film`() {
        assertFalse(PlaybackPolicy.isLive("http://host.invalid/live/u/p/1.ts", 5_400.0))
    }

    @Test
    fun `movie ailleurs que dans le premier segment ne compte pas`() {
        assertTrue(PlaybackPolicy.isLive("http://host.invalid/live/movie/1.ts", 0.0))
        assertTrue(PlaybackPolicy.isLive("http://host.invalid/live/1.ts?type=/movie/", 0.0))
    }

    // Flux http redirigé vers https sans certificats → « connexion sécurisée impossible à vérifier »
    @Test
    fun `échec TLS sans certificats donne le message de connexion sécurisée`() {
        assertEquals(PlaybackPolicy.TLS_CA_UNAVAILABLE, PlaybackPolicy.loadFailureCode(tlsFailed = true, certificatesAvailable = false))
        // Avec certificats, un échec TLS (certificat invalide) reste un échec de connexion
        assertEquals(PlaybackPolicy.LOAD_FAILED, PlaybackPolicy.loadFailureCode(tlsFailed = true, certificatesAvailable = true))
        assertEquals(PlaybackPolicy.LOAD_FAILED, PlaybackPolicy.loadFailureCode(tlsFailed = false, certificatesAvailable = false))
        assertEquals(PlaybackPolicy.LOAD_FAILED, PlaybackPolicy.loadFailureCode(tlsFailed = false, certificatesAvailable = true))
    }

    @Test
    fun `messages de la couche TLS reconnus`() {
        assertTrue(PlaybackPolicy.isTlsFailure("tls: No CA chain is set, but required to operate. Was the CA correctly set?"))
        assertTrue(PlaybackPolicy.isTlsFailure("tls: mbedtls_ssl_handshake returned -0x2700"))
        assertTrue(PlaybackPolicy.isTlsFailure("The certificate is not correctly signed by the trusted CA."))
        assertTrue(PlaybackPolicy.isTlsFailure("tls: TLS handshake was aborted by peer."))
        assertTrue(PlaybackPolicy.isTlsFailure("mbedtls_ssl_get_verify_result reported problems with the certificate verification"))
        // Une adresse qui contient « tls » ou « certificate » n'est pas un échec TLS
        assertFalse(PlaybackPolicy.isTlsFailure("Opening http://tls.host.invalid/certificate/1.ts"))
        assertFalse(PlaybackPolicy.isTlsFailure("Failed to open http://host.invalid/live/u/p/1.ts."))
        assertFalse(PlaybackPolicy.isTlsFailure("HTTP error 404 Not Found"))
        assertFalse(PlaybackPolicy.isTlsFailure("Opening failed or was aborted: https://host.invalid/movie/u/p/42.mkv"))
    }

    @Test
    fun `cache réduit sur un appareil à peu de mémoire`() {
        val small = PlaybackPolicy.CacheSizes(32 * mib, 8 * mib)
        val normal = PlaybackPolicy.CacheSizes(64 * mib, 32 * mib)
        assertEquals(small, PlaybackPolicy.cacheSizes(2 * gib, lowRamDevice = false))
        assertEquals(small, PlaybackPolicy.cacheSizes(8 * gib, lowRamDevice = true))
        assertEquals(normal, PlaybackPolicy.cacheSizes(8 * gib, lowRamDevice = false))
        // Mémoire inconnue : comme avant
        assertEquals(normal, PlaybackPolicy.cacheSizes(0, lowRamDevice = false))
    }
}
