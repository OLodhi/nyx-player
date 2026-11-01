package com.nyxplayer.nativebridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SystemCaBundleTest {
    @get:Rule
    val tmp = TemporaryFolder()

    private fun pem(name: String) = "-----BEGIN CERTIFICATE-----\n$name\n-----END CERTIFICATE-----"

    /** Un dossier de certificats : un fichier par certificat, avec du texte autour comme sur Android */
    private fun dir(name: String, vararg certificates: String): File =
        tmp.newFolder(name).also { d ->
            certificates.forEach { File(d, "$it.0").writeText("Certificate:\n    Subject: CN=$it\n${pem(it)}\nSHA1 Fingerprint=00\n") }
        }

    @Test
    fun `le premier magasin qui a des certificats est pris seul, sans mélange`() {
        val apex = dir("apex", "a", "b")
        // Autorité retirée de l'APEX par une mise à jour, encore présente dans /system : pas reprise
        val system = dir("system", "b", "retiree")

        assertEquals(listOf(pem("a"), pem("b")), SystemCaBundle.firstStore(listOf(apex, system)))
    }

    @Test
    fun `sans le premier magasin, le second est utilisé`() {
        val missing = File(tmp.root, "absent")
        val empty = tmp.newFolder("vide")
        val system = dir("system", "c")

        assertEquals(listOf(pem("c")), SystemCaBundle.firstStore(listOf(missing, empty, system)))
    }

    @Test
    fun `aucun magasin lisible, aucun certificat`() {
        assertTrue(SystemCaBundle.firstStore(listOf(File(tmp.root, "absent"))).isEmpty())
    }

    @Test
    fun `seuls les blocs de certificat sont gardés`() {
        val text = """
            Certificate:
                Subject: CN=Test
            -----BEGIN CERTIFICATE-----
            MIIB
            -----END CERTIFICATE-----
            SHA1 Fingerprint=00:11
        """.trimIndent()

        assertEquals(listOf("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----"), SystemCaBundle.pemBlocks(text))
    }
}
