package com.nyxplayer.nativebridge

/**
 * Règles du lecteur sans appel Android, pour être testées sur la JVM (PlaybackPolicyTest).
 */
internal object PlaybackPolicy {
    /** Film ou épisode Xtream : `http://hôte/movie/…` ou `http://hôte/series/…`. */
    private val VOD_URL = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]+/(movie|series)/")

    fun isVodUrl(url: String): Boolean = VOD_URL.containsMatchIn(url)

    /**
     * Direct : durée inconnue ou nulle, sauf pour un film ou un épisode. Certains films n'annoncent
     * pas de durée (fichier sans index, durée pas encore lue) : les traiter comme un direct les
     * faisait repartir du début après un passage par Accueil ou un appel.
     */
    fun isLive(url: String, duration: Double): Boolean = duration <= 0.0 && !isVodUrl(url)

    /** Flux chiffré : sans certificats de confiance, il n'est pas lu. */
    fun isHttps(url: String): Boolean = url.trimStart().startsWith("https://", ignoreCase = true)

    // Codes d'erreur envoyés à l'interface (classifyNativeError, playbackErrors.ts)
    /** Certificats du système indisponibles : flux HTTPS impossible à vérifier, pas de relance. */
    const val TLS_CA_UNAVAILABLE = "TLS_CA_UNAVAILABLE"
    /** Flux qui ne s'ouvre pas (réseau, serveur) : relances espacées. */
    const val LOAD_FAILED = "MPV_LOAD_FAILED"

    /**
     * Message de la couche TLS de FFmpeg (mbedtls), relayé par libmpv : « tls: … »,
     * « mbedtls_ssl_handshake returned … », « No CA chain is set … », certificat refusé. Pas un
     * simple mot : une adresse (`http://tls.hote/…`) ne doit pas passer pour un échec TLS.
     */
    private val TLS_FAILURE = Regex(
        """^tls:|mbedtls|No CA chain|certificate (verification|is not correctly signed)""",
        RegexOption.IGNORE_CASE,
    )

    fun isTlsFailure(logLine: String): Boolean = TLS_FAILURE.containsMatchIn(logLine)

    /**
     * Code d'un flux qui n'a pas pu s'ouvrir. Sans certificats, seule l'adresse de départ en https
     * est refusée avant la lecture : un flux http redirigé vers https (ou une liste HLS en http aux
     * segments en https) échoue à la vérification. L'utilisateur doit alors voir « connexion
     * sécurisée impossible à vérifier », pas « connexion au flux impossible » avec des relances
     * vaines.
     */
    fun loadFailureCode(tlsFailed: Boolean, certificatesAvailable: Boolean): String =
        if (tlsFailed && !certificatesAvailable) TLS_CA_UNAVAILABLE else LOAD_FAILED

    /** Cache de lecture (octets) : en avant, et en arrière pour revenir quelques secondes sans réseau. */
    data class CacheSizes(val forwardBytes: Long, val backBytes: Long)

    private const val MIB = 1024L * 1024L
    private const val LOW_MEMORY_BYTES = 3L * 1024L * MIB

    /**
     * Appareil à peu de mémoire (Chromecast avec Google TV : 2 Go, dont une bonne part pour le
     * système) : un cache plus petit, sinon Android peut fermer l'app pendant la lecture.
     * 32 Mo suffisent à environ 25 s d'un direct à 10 Mbit/s. Ailleurs, un peu plus que sur PC
     * (50 + 25 Mo, mpvBridge.ts), comme avant.
     */
    fun cacheSizes(totalMemoryBytes: Long, lowRamDevice: Boolean): CacheSizes =
        if (lowRamDevice || (totalMemoryBytes in 1 until LOW_MEMORY_BYTES)) {
            CacheSizes(32 * MIB, 8 * MIB)
        } else {
            CacheSizes(64 * MIB, 32 * MIB)
        }
}
