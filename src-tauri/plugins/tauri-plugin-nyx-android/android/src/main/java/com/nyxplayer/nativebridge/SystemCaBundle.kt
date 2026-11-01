package com.nyxplayer.nativebridge

import android.content.Context
import java.io.File
import kotlin.concurrent.thread

/**
 * Exports the Android system trust store into a single PEM bundle usable by mbedtls, so libmpv
 * verifies HTTPS certificates like the rest of the system.
 *
 * One source only, the first that holds certificates (one PEM certificate per file plus a human
 * readable dump):
 * - `/apex/com.android.conscrypt/cacerts` (Android 14+): the store Android actually trusts, updated
 *   through Google Play system updates (an authority withdrawn there must not come back);
 * - `/system/etc/security/cacerts`: the historical store, used when the first one is missing.
 * Never merged: on Android 14+, /system still holds authorities the APEX has withdrawn. Without any
 * certificate, HTTPS streams are refused (MpvEngine), never played unverified.
 *
 * Only the `BEGIN/END CERTIFICATE` blocks are kept: mbedtls rejects files mixing PEM and text.
 * Rebuilt once per process: file dates of a system image are its build date, so they cannot tell
 * whether the store changed (OS or Conscrypt update, certificate removed).
 *
 * Lire et réécrire ≈ 150 fichiers prend un moment : [prefetch] le fait en arrière-plan au chargement
 * du plugin, pour que la première lecture ne bloque pas l'interface. Le résultat est gardé
 * pour la durée du processus ; un échec est retenté à la lecture suivante d'un flux HTTPS.
 */
object SystemCaBundle {
    private val SYSTEM_CA_DIRS = listOf(
        File("/apex/com.android.conscrypt/cacerts"),
        File("/system/etc/security/cacerts"),
    )
    private const val BUNDLE_NAME = "system-cacerts.pem"
    private val PEM_BLOCK = Regex("-----BEGIN CERTIFICATE-----[\\s\\S]+?-----END CERTIFICATE-----")

    private val lock = Any()
    @Volatile private var bundle: File? = null

    /** Prépare le fichier sur un fil d'arrière-plan (sans attendre). */
    fun prefetch(context: Context) {
        val appContext = context.applicationContext
        thread(name = "nyx-ca-bundle", isDaemon = true) { ensure(appContext) }
    }

    /** Fichier prêt, ou null si l'export échoue. Si [prefetch] tourne encore, attend sa fin. */
    fun ensure(context: Context): File? {
        bundle?.let { return it }
        synchronized(lock) {
            bundle?.let { return it }
            return export(context.filesDir).also { bundle = it }
        }
    }

    /** PEM certificates of one file, without the text dump around them. */
    internal fun pemBlocks(text: String): List<String> = PEM_BLOCK.findAll(text).map { it.value }.toList()

    /** Certificates of one directory, sorted by file name; empty when it is missing or unreadable. */
    internal fun certificatesOf(dir: File): List<String> =
        runCatching { dir.listFiles()?.filter { it.isFile }.orEmpty() }.getOrDefault(emptyList())
            .sortedBy { it.name }
            // Un fichier illisible ne fait pas échouer tout l'export
            .flatMap { file -> runCatching { pemBlocks(file.readText()) }.getOrDefault(emptyList()) }

    /** Certificates of the first directory that holds any (never a mix of two stores). */
    internal fun firstStore(dirs: List<File>): List<String> =
        dirs.asSequence().map { certificatesOf(it) }.firstOrNull { it.isNotEmpty() }.orEmpty()

    /** Writes the bundle into [outDir]; null when no certificate could be read. */
    internal fun export(outDir: File, dirs: List<File> = SYSTEM_CA_DIRS): File? = runCatching {
        val certificates = firstStore(dirs)
        if (certificates.isEmpty()) {
            StreamDiagnostics.warn("libmpv", "system CA bundle: no certificate found")
            return null
        }
        // Écrit à côté puis renommé : une écriture interrompue ne laisse jamais un fichier tronqué
        val file = File(outDir, BUNDLE_NAME)
        val partial = File(outDir, "$BUNDLE_NAME.tmp")
        partial.writeText(certificates.joinToString(separator = "\n", postfix = "\n"))
        if (!partial.renameTo(file)) {
            partial.delete()
            error("rename failed")
        }
        StreamDiagnostics.log("libmpv", "system CA bundle exported: ${certificates.size} certificates")
        file
    }.getOrElse { e ->
        StreamDiagnostics.warn("libmpv", "system CA bundle export failed: ${e.javaClass.simpleName}")
        null
    }
}
