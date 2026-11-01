package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdatePolicyTest {
    private val nyx = setOf("acf30887")

    @Test
    fun `processeur de l'APK installé, d'après le dossier de ses bibliothèques`() {
        assertEquals("arm64", AppUpdatePolicy.abiFromLibraryDir("/data/app/~~x/com.nyxplayer.app-1/lib/arm64"))
        assertEquals("armv7", AppUpdatePolicy.abiFromLibraryDir("/data/app/com.nyxplayer.app-1/lib/arm/"))
        assertEquals("x86_64", AppUpdatePolicy.abiFromLibraryDir("/data/app/com.nyxplayer.app-1/lib/x86_64"))
        assertNull(AppUpdatePolicy.abiFromLibraryDir("/data/app/com.nyxplayer.app-1/lib/mips"))
        assertNull(AppUpdatePolicy.abiFromLibraryDir(null))
    }

    @Test
    fun `repli sur le mode de l'app, Chromecast 32 bits, téléphone 64 bits`() {
        assertEquals("armv7", AppUpdatePolicy.abiFromSupported(false, emptyList(), listOf("armeabi-v7a", "armeabi")))
        assertEquals("arm64", AppUpdatePolicy.abiFromSupported(true, listOf("arm64-v8a"), listOf("armeabi-v7a")))
        // Téléphone 64 bits qui ferait tourner l'APK 32 bits : on garde l'armv7
        assertEquals("armv7", AppUpdatePolicy.abiFromSupported(false, listOf("arm64-v8a"), listOf("armeabi-v7a")))
        assertNull(AppUpdatePolicy.abiFromSupported(true, emptyList(), listOf("armeabi-v7a")))
    }

    private fun testAllows(url: String) = AppUpdatePolicy.isAllowedUrl(url, false, AppUpdatePolicy.RELEASE_APK_PREFIX)
    private fun releaseAllows(url: String, prefix: String = AppUpdatePolicy.RELEASE_APK_PREFIX) =
        AppUpdatePolicy.isAllowedUrl(url, true, prefix)

    @Test
    fun `version de test, https partout et http seulement sur le réseau local`() {
        assertTrue(testAllows("https://releases.nyxplayer.app/nyx-player-arm64-v0.8.1.apk"))
        assertTrue(testAllows("https://ailleurs.example/nyx.apk"))
        assertTrue(testAllows("http://10.0.2.2:8000/android.json"))
        assertTrue(testAllows("http://192.168.50.20:8000/nyx.apk"))
        assertTrue(testAllows("http://172.20.0.5/nyx.apk"))
        assertFalse(testAllows("http://releases.nyxplayer.app/nyx.apk"))
        assertFalse(testAllows("http://172.32.0.5/nyx.apk"))
        assertFalse(testAllows("http://8.8.8.8/nyx.apk"))
        assertFalse(testAllows("file:///sdcard/nyx.apk"))
        assertFalse(testAllows("content://downloads/nyx.apk"))
        assertFalse(testAllows("https://user:pass@releases.nyxplayer.app/nyx.apk"))
        assertFalse(testAllows("pas une adresse"))
    }

    @Test
    fun `app publiée, seules les adresses de Nyx, même si la page était détournée`() {
        assertTrue(releaseAllows("https://releases.nyxplayer.app/nyx-player-arm64-v0.8.1.apk"))
        assertTrue(releaseAllows("https://nyxplayer.app/updates/android.json", AppUpdatePolicy.RELEASE_MANIFEST_PREFIX))
        assertFalse(releaseAllows("https://ailleurs.example/nyx.apk"))
        assertFalse(releaseAllows("https://releases.nyxplayer.app.ailleurs.example/nyx.apk"))
        assertFalse(releaseAllows("https://releases.nyxplayer.app:8443/nyx.apk"))
        assertFalse(releaseAllows("http://192.168.50.20:8000/nyx.apk"))
        assertFalse(releaseAllows("http://releases.nyxplayer.app/nyx.apk"))
        assertFalse(releaseAllows("https://nyxplayer.app/autre/android.json", AppUpdatePolicy.RELEASE_MANIFEST_PREFIX))
        assertFalse(releaseAllows("https://nyxplayer.app/updates/../autre.json", AppUpdatePolicy.RELEASE_MANIFEST_PREFIX))
        assertFalse(releaseAllows("https://nyxplayer.app/updates/%2e%2e/autre.json", AppUpdatePolicy.RELEASE_MANIFEST_PREFIX))
    }

    @Test
    fun `clé de publication reconnue à son empreinte`() {
        assertTrue(AppUpdatePolicy.isReleaseSigned(setOf(AppUpdatePolicy.RELEASE_CERT_SHA256)))
        assertFalse(AppUpdatePolicy.isReleaseSigned(setOf("debug")))
        assertFalse(AppUpdatePolicy.isReleaseSigned(emptySet()))
    }

    @Test
    fun `empreinte SHA-256 en hexadécimal`() {
        assertTrue(AppUpdatePolicy.isSha256Hex("a".repeat(64)))
        assertTrue(AppUpdatePolicy.isSha256Hex("ACF3".repeat(16)))
        assertFalse(AppUpdatePolicy.isSha256Hex("a".repeat(63)))
        assertFalse(AppUpdatePolicy.isSha256Hex("g".repeat(64)))
    }

    @Test
    fun `APK bon, même app, même clé, version plus grande`() {
        assertNull(AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8000, 8001, nyx, nyx))
    }

    @Test
    fun `APK refusé, autre app, autre clé, version pas plus grande`() {
        assertEquals("package", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app.banc", 8000, 8001, nyx, nyx))
        assertEquals("package", AppUpdatePolicy.verdict("com.nyxplayer.app", null, 8000, 8001, nyx, nyx))
        // APK de la CI (clé de debug) face à l'app publiée, et l'inverse
        assertEquals("signature", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8000, 8001, nyx, setOf("debug")))
        assertEquals("version", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8001, 8001, nyx, nyx))
        assertEquals("version", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8001, 8000, nyx, nyx))
    }

    @Test
    fun `l'APK doit porter la version annoncée à l'utilisateur`() {
        assertNull(AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8000, 8001, nyx, nyx, "0.8.1", "0.8.1"))
        // Manifeste qui annonce une version, APK signé Nyx plus récent mais d'une autre version
        assertEquals("version", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8000, 8001, nyx, nyx, "9.9.9", "0.8.1"))
        assertEquals("version", AppUpdatePolicy.verdict("com.nyxplayer.app", "com.nyxplayer.app", 8000, 8001, nyx, nyx, "0.8.1", null))
    }

    @Test
    fun `clé, rotation acceptée, illisible laissée à Android`() {
        assertTrue(AppUpdatePolicy.signersMatch(nyx, setOf("ancienne", "acf30887")))
        assertTrue(AppUpdatePolicy.signersMatch(nyx, null))
        assertTrue(AppUpdatePolicy.signersMatch(nyx, emptySet()))
        assertTrue(AppUpdatePolicy.signersMatch(emptySet(), setOf("debug")))
        assertFalse(AppUpdatePolicy.signersMatch(nyx, setOf("debug")))
    }
}
