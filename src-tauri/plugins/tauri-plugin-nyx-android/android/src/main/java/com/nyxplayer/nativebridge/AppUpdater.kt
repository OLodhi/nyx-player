package com.nyxplayer.nativebridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Process
import android.provider.Settings
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

/**
 * Mise à jour de l'app depuis l'app (téléphone et TV) : lecture du manifeste, téléchargement de
 * l'APK dans le cache, vérifications, ouverture de l'installateur Android.
 *
 * Les décisions sont dans AppUpdatePolicy (testée sur la JVM) et dans le front-end
 * (src/services/androidUpdate.ts). Android refuse lui-même une mise à jour signée avec une autre
 * clé : les vérifications d'ici donnent un message clair avant, et écartent un fichier abîmé.
 */
internal class AppUpdater(private val activity: Activity) {
    private val packageManager: PackageManager get() = activity.packageManager
    private val updateDir: File get() = File(activity.cacheDir, UPDATE_DIR)
    private val apkFile: File get() = File(updateDir, APK_NAME)

    data class Info(val packageName: String, val versionName: String, val abi: String?)

    /**
     * Vrai seulement quand `apkFile` est l'APK que `verify` vient d'accepter : `install` n'ouvre
     * jamais l'installateur sur un fichier laissé là sans vérification.
     */
    @Volatile private var verified = false

    /**
     * APK d'une mise à jour précédente (déjà installée ou abandonnée) : retiré au lancement.
     * L'appelant s'assure qu'aucun téléchargement n'est en cours.
     */
    fun cleanUp() {
        verified = false
        updateDir.deleteRecursively()
    }

    fun info(): Info {
        val installed = packageManager.getPackageInfo(activity.packageName, 0)
        val abi = AppUpdatePolicy.abiFromLibraryDir(activity.applicationInfo.nativeLibraryDir)
            ?: AppUpdatePolicy.abiFromSupported(
                Process.is64Bit(),
                Build.SUPPORTED_64_BIT_ABIS.toList(),
                Build.SUPPORTED_32_BIT_ABIS.toList(),
            )
        return Info(activity.packageName, installed.versionName ?: "", abi)
    }

    /** App signée avec la clé de publication : adresses limitées à celles de Nyx (AppUpdatePolicy) */
    private val releaseSigned: Boolean by lazy {
        AppUpdatePolicy.isReleaseSigned(currentSigners(packageManager.getPackageInfo(activity.packageName, signingFlags())))
    }

    /** Texte du manifeste, ou null (adresse refusée, réseau, réponse autre que 200, trop gros) */
    fun fetchManifest(url: String): String? {
        if (!AppUpdatePolicy.isAllowedUrl(url, releaseSigned, AppUpdatePolicy.RELEASE_MANIFEST_PREFIX)) return null
        return try {
            val connection = open(url)
            try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
                // Après une redirection, l'adresse finale doit être permise elle aussi
                if (!AppUpdatePolicy.isAllowedUrl(connection.url.toString(), releaseSigned, AppUpdatePolicy.RELEASE_MANIFEST_PREFIX)) return null
                val bytes = connection.inputStream.use { input ->
                    val buffer = ByteArray(AppUpdatePolicy.MAX_MANIFEST_BYTES + 1)
                    var total = 0
                    while (total < buffer.size) {
                        val read = input.read(buffer, total, buffer.size - total)
                        if (read < 0) break
                        total += read
                    }
                    if (total > AppUpdatePolicy.MAX_MANIFEST_BYTES) return null
                    buffer.copyOf(total)
                }
                String(bytes, Charsets.UTF_8)
            } finally {
                connection.disconnect()
            }
        } catch (e: IOException) {
            null
        }
    }

    /**
     * Télécharge l'APK et le vérifie. Null si tout est bon, sinon le code de l'échec : network,
     * storage, checksum, package, signature, version. Un fichier refusé est effacé.
     */
    fun download(url: String, sha256: String, size: Long, version: String, onProgress: (Long, Long) -> Unit): String? {
        if (!AppUpdatePolicy.isAllowedUrl(url, releaseSigned, AppUpdatePolicy.RELEASE_APK_PREFIX) ||
            !AppUpdatePolicy.isSha256Hex(sha256)
        ) return "network"
        if (size <= 0 || size > AppUpdatePolicy.MAX_APK_BYTES) return "checksum"
        cleanUp()
        if (!updateDir.isDirectory && !updateDir.mkdirs()) return "storage"
        if (updateDir.usableSpace < size + AppUpdatePolicy.FREE_SPACE_MARGIN_BYTES) return "storage"

        val partial = File(updateDir, "$APK_NAME.part")
        val digest = MessageDigest.getInstance("SHA-256")
        var downloaded = 0L
        try {
            val connection = open(url)
            try {
                if (connection.responseCode != HttpURLConnection.HTTP_OK) return "network"
                // Après une redirection, l'adresse finale doit être permise elle aussi
                if (!AppUpdatePolicy.isAllowedUrl(connection.url.toString(), releaseSigned, AppUpdatePolicy.RELEASE_APK_PREFIX)) return "network"
                connection.inputStream.use { input ->
                    partial.outputStream().use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var lastPercent = -1L
                        while (true) {
                            val read = input.read(buffer)
                            if (read < 0) break
                            downloaded += read
                            // Plus long qu'annoncé : ce n'est pas le fichier attendu, inutile d'aller au bout
                            if (downloaded > size) {
                                partial.delete()
                                return "checksum"
                            }
                            digest.update(buffer, 0, read)
                            output.write(buffer, 0, read)
                            val percent = downloaded * 100 / size
                            if (percent != lastPercent) {
                                lastPercent = percent
                                onProgress(downloaded, size)
                            }
                        }
                    }
                }
            } finally {
                connection.disconnect()
            }
        } catch (e: IOException) {
            partial.delete()
            return if (updateDir.usableSpace < AppUpdatePolicy.FREE_SPACE_MARGIN_BYTES) "storage" else "network"
        }

        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (downloaded != size || !actual.equals(sha256, ignoreCase = true)) {
            partial.delete()
            return "checksum"
        }
        if (!partial.renameTo(apkFile)) {
            partial.delete()
            return "storage"
        }
        val failure = verify(apkFile, version)
        if (failure != null) apkFile.delete() else verified = true
        return failure
    }

    /**
     * Autorisation « Installer des applis inconnues », demandée AVANT le téléchargement : changer ce
     * réglage peut redémarrer l'app, qui efface alors l'APK du cache. Vrai : déjà accordée. Faux :
     * l'écran du réglage est ouvert pour Nyx. Box sans cet écran : vrai, l'installateur d'Android
     * posera lui-même la question.
     */
    fun requestInstallPermission(): Boolean {
        if (packageManager.canRequestPackageInstalls()) return true
        return !openInstallSettings()
    }

    private fun openInstallSettings(): Boolean = try {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    /**
     * Ouvre l'installateur sur l'APK vérifié. « permission » : l'écran Android « Installer des applis
     * inconnues » a été ouvert pour Nyx, l'installation se relance au retour. Null : installateur
     * ouvert. Sinon le code de l'échec (missing, install).
     */
    fun install(): String? {
        if (!verified || !apkFile.isFile) return "missing"
        // Box sans l'écran du réglage : l'installateur d'Android pose lui-même la question
        if (!packageManager.canRequestPackageInstalls() && openInstallSettings()) return "permission"
        return try {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", apkFile)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, APK_MIME)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            // L'installateur du système, pas une autre app qui se déclarerait pour les APK (et recevrait
            // le droit de lire le fichier) ; sans installateur système trouvé, Android choisit
            systemInstaller(intent)?.let { intent.setPackage(it) }
            activity.startActivity(intent)
            null
        } catch (e: ActivityNotFoundException) {
            "install"
        } catch (e: IllegalArgumentException) {
            "install"
        } catch (e: SecurityException) {
            "install"
        }
    }

    @Suppress("DEPRECATION")
    private fun systemInstaller(intent: Intent): String? =
        packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
            .firstOrNull { (it.activityInfo.applicationInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0 }
            ?.activityInfo?.packageName

    private fun verify(file: File, announcedVersion: String): String? {
        val installed = packageManager.getPackageInfo(activity.packageName, signingFlags())
        val archive = archiveInfo(file) ?: return "package"
        return AppUpdatePolicy.verdict(
            expectedPackage = activity.packageName,
            archivePackage = archive.packageName,
            installedVersionCode = PackageInfoCompat.getLongVersionCode(installed),
            archiveVersionCode = PackageInfoCompat.getLongVersionCode(archive),
            installedSigners = currentSigners(installed),
            archiveSigners = allSigners(archive),
            announcedVersion = announcedVersion,
            archiveVersionName = archive.versionName,
        )
    }

    private fun archiveInfo(file: File): PackageInfo? {
        val info = packageManager.getPackageArchiveInfo(file.path, signingFlags()) ?: return null
        // Certaines versions d'Android ne lisent pas les certificats d'un APK non installé avec le
        // drapeau récent : nouvel essai avec l'ancien
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && info.signingInfo == null) {
            @Suppress("DEPRECATION")
            return packageManager.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNATURES) ?: info
        }
        return info
    }

    @Suppress("DEPRECATION")
    private fun signingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

    /** Clé(s) avec laquelle l'app installée est signée aujourd'hui */
    @Suppress("DEPRECATION")
    private fun currentSigners(info: PackageInfo): Set<String> {
        val signing = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo else null
        val signatures = when {
            signing == null -> info.signatures
            signing.hasMultipleSigners() -> signing.apkContentsSigners
            else -> signing.signingCertificateHistory?.lastOrNull()?.let { arrayOf(it) }
        }
        return signatures.orEmpty().map { fingerprint(it.toByteArray()) }.toSet()
    }

    /** Clés de l'APK téléchargé, anciennes clés de sa rotation comprises */
    @Suppress("DEPRECATION")
    private fun allSigners(info: PackageInfo): Set<String> {
        val signing = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.signingInfo else null
        val signatures = when {
            signing == null -> info.signatures
            signing.hasMultipleSigners() -> signing.apkContentsSigners
            else -> signing.signingCertificateHistory
        }
        return signatures.orEmpty().map { fingerprint(it.toByteArray()) }.toSet()
    }

    private fun fingerprint(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private fun open(url: String): HttpURLConnection =
        (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            // Redirections suivies dans le même protocole seulement (comportement de HttpURLConnection)
            instanceFollowRedirects = true
            useCaches = false
        }

    private companion object {
        const val UPDATE_DIR = "updates"
        const val APK_NAME = "nyx-update.apk"
        const val APK_MIME = "application/vnd.android.package-archive"
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 30_000
    }
}
