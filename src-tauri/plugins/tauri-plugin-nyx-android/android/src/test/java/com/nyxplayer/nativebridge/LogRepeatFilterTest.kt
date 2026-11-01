package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LogRepeatFilterTest {
    @Test
    fun `message identique masqué pendant la fenêtre puis compté`() {
        val filter = LogRepeatFilter()
        assertEquals("vd: Could not find ref with POC 12", filter.admit("vd", "Could not find ref with POC 12", 0))
        // Seuls les chiffres changent : même message
        assertNull(filter.admit("vd", "Could not find ref with POC 13", 500))
        assertNull(filter.admit("vd", "Could not find ref with POC 14", 1_999))
        assertEquals(
            "vd: Could not find ref with POC 15 (+2 identiques)",
            filter.admit("vd", "Could not find ref with POC 15", 2_000),
        )
        // Le compteur repart de zéro après chaque ligne journalisée
        assertEquals("vd: Could not find ref with POC 16", filter.admit("vd", "Could not find ref with POC 16", 4_000))
    }

    @Test
    fun `préfixe ou texte différents ne sont pas regroupés`() {
        val filter = LogRepeatFilter()
        assertEquals("vd: decoding error", filter.admit("vd", "decoding error", 0))
        assertEquals("ad: decoding error", filter.admit("ad", "decoding error", 10))
        assertEquals("vd: other error", filter.admit("vd", "other error", 20))
    }

    @Test
    fun `la table ne gonfle pas sans fin`() {
        val filter = LogRepeatFilter(windowMs = 2_000, maxKeys = 2)
        filter.admit("vd", "a", 0)
        filter.admit("vd", "b", 0)
        filter.admit("vd", "c", 0)
        // Table pleine (3 > 2) : vidée avant d'ajouter « d », « a » est oublié et repasse aussitôt
        filter.admit("vd", "d", 0)
        assertEquals("vd: a", filter.admit("vd", "a", 1))
    }
}
