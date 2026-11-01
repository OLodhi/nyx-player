package com.nyxplayer.nativebridge

import java.net.URI

/**
 * Décisions de la mise à jour de l'app, sans appel Android (testées sur la JVM, AppUpdatePolicyTest).
 * AppUpdater lit le système, le réseau et les fichiers, et passe les valeurs ici.
 */
internal object AppUpdatePolicy {
    /** android.json fait quelques centaines d'octets : au-delà, ce n'est pas lui */
    const val MAX_MANIFEST_BYTES = 64 * 1024

    /** Même plafond que le front-end (src/services/androidUpdate.ts) */
    const val MAX_APK_BYTES = 300L * 1024 * 1024

    /** Marge laissée libre sur l'appareil en plus de l'APK */
    const val FREE_SPACE_MARGIN_BYTES = 20L * 1024 * 1024

    /**
     * Processeur de l'APK installé, d'après le dossier de ses bibliothèques natives
     * (`…/lib/arm64`, `…/lib/arm`). Les APK sont séparés par processeur : celui de la mise à jour
     * doit être le même, quel que soit ce que l'appareil accepterait d'autre.
     */
    fun abiFromLibraryDir(dir: String?): String? = when (dir?.trimEnd('/')?.substringAfterLast('/')) {
        "arm64" -> "arm64"
        "arm" -> "armv7"
        "x86_64" -> "x86_64"
        "x86" -> "x86"
        else -> null
    }

    /** Repli si le dossier ne dit rien : premier processeur du mode (32 ou 64 bits) de l'app */
    fun abiFromSupported(is64Bit: Boolean, abis64: List<String>, abis32: List<String>): String? =
        when ((if (is64Bit) abis64 else abis32).firstOrNull()) {
            "arm64-v8a" -> "arm64"
            "armeabi-v7a" -> "armv7"
            "x86_64" -> "x86_64"
            "x86" -> "x86"
            else -> null
        }

    /** Empreinte SHA-256 du certificat de la clé de publication (scripts/android-release-apk.ps1) */
    const val RELEASE_CERT_SHA256 = "acf30887eaecc988bc9cf59217c3d54a6d79e78f0e090a49eb481a7c504a9d28"

    /** Adresses de la version publiée : manifeste sur le site, APK sur le bucket R2 */
    const val RELEASE_MANIFEST_PREFIX = "https://nyxplayer.app/updates/"
    const val RELEASE_APK_PREFIX = "https://releases.nyxplayer.app/"

    /**
     * App signée avec la clé de publication : seules les adresses de Nyx sont permises.
     * Si la clé de publication change un jour (rotation), mettre à jour RELEASE_CERT_SHA256 : sinon
     * l'app publiée retomberait dans le mode des versions de test (toute adresse https).
     */
    fun isReleaseSigned(signers: Set<String>): Boolean = RELEASE_CERT_SHA256 in signers

    /**
     * Adresses permises. App publiée (clé de publication) : uniquement `releasePrefix` en https, même
     * si la page était détournée. Versions de test (clé de debug : CI, audit, émulateurs) : https
     * partout, et http vers le réseau local (manifeste et APK servis par le PC). Les services de Nyx
     * refusent de toute façon le clair (network_security_config.xml).
     */
    fun isAllowedUrl(url: String, releaseSigned: Boolean, releasePrefix: String): Boolean {
        val uri = try {
            URI(url).normalize()
        } catch (e: Exception) {
            return false
        }
        val host = uri.host?.lowercase() ?: return false
        if (uri.userInfo != null) return false
        val scheme = uri.scheme?.lowercase()
        if (releaseSigned) {
            val prefix = URI(releasePrefix)
            val path = uri.rawPath ?: ""
            // « % » refusé : un « %2e%2e » encodé passerait le contrôle des « .. »
            return scheme == "https" && host == prefix.host && uri.port == -1 &&
                path.startsWith(prefix.rawPath) && !path.contains("..") && !path.contains('%')
        }
        return when (scheme) {
            "https" -> true
            "http" -> isLocalHost(host)
            else -> false
        }
    }

    private fun isLocalHost(host: String): Boolean {
        if (host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2") return true
        val parts = host.split('.').map { it.toIntOrNull() ?: return false }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 ||
            (parts[0] == 192 && parts[1] == 168) ||
            (parts[0] == 172 && parts[1] in 16..31)
    }

    fun isSha256Hex(value: String): Boolean = value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }

    /**
     * Clé de l'APK téléchargé face à celle de l'app installée (empreintes SHA-256 des certificats).
     * `archive` : certificats de l'APK, historique de rotation compris. L'un ou l'autre illisible
     * (vide) sur cette version d'Android : Android vérifie de toute façon la clé à l'installation,
     * la décision lui revient.
     */
    fun signersMatch(installed: Set<String>, archive: Set<String>?): Boolean {
        if (archive.isNullOrEmpty() || installed.isEmpty()) return true
        return archive.containsAll(installed)
    }

    /**
     * Verdict sur l'APK téléchargé, avant l'installateur : null s'il est bon, sinon le code de
     * l'échec (traduit par le front-end). `announcedVersion` : version affichée à l'utilisateur, lue
     * dans le manifeste (qui n'est pas signé) ; l'APK doit porter exactement celle-là, sinon
     * l'interface annoncerait une version et en installerait une autre.
     */
    fun verdict(
        expectedPackage: String,
        archivePackage: String?,
        installedVersionCode: Long,
        archiveVersionCode: Long,
        installedSigners: Set<String>,
        archiveSigners: Set<String>?,
        announcedVersion: String? = null,
        archiveVersionName: String? = null,
    ): String? = when {
        archivePackage != expectedPackage -> "package"
        !signersMatch(installedSigners, archiveSigners) -> "signature"
        archiveVersionCode <= installedVersionCode -> "version"
        announcedVersion != null && archiveVersionName != announcedVersion -> "version"
        else -> null
    }
}
