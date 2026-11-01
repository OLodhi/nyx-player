package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SecureStoreFormatTest {
    @Test
    fun `iv et chiffré séparés par deux-points`() {
        val stored = SecureStoreFormat.join("aXY=", "cGF5bG9hZA==")
        assertEquals("aXY=:cGF5bG9hZA==", stored)
        assertEquals("aXY=" to "cGF5bG9hZA==", SecureStoreFormat.split(stored))
    }

    @Test
    fun `valeur d'un autre format refusée`() {
        // Ancienne valeur en clair, ou valeur abîmée : effacée par SecureStore
        assertNull(SecureStoreFormat.split("jeton-en-clair"))
        assertNull(SecureStoreFormat.split("a:b:c"))
        assertNull(SecureStoreFormat.split(""))
    }

    @Test
    fun `parties vides gardées telles quelles`() {
        // Le déchiffrement échouera ensuite (géré par SecureStore), le format seul ne décide pas
        assertEquals("" to "", SecureStoreFormat.split(":"))
    }
}
