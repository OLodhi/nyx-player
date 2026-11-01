package com.nyxplayer.nativebridge

/**
 * Ce que la page peut demander au lecteur, sans appel Android pour être testé sur la JVM
 * (PlayerInputPolicyTest). Protocoles et `userAgent` : mêmes règles que le lecteur Windows
 * (`src-tauri/src/mpv_guard.rs`) ; propriétés lisibles : une liste fermée, plus stricte que sous
 * Windows. libmpv sait aussi ouvrir des fichiers locaux, des listes de lecture ou des
 * pseudo-protocoles, et lire des propriétés que l'app ne montre jamais.
 */
internal object PlayerInputPolicy {
    /** Protocoles de flux réseau acceptés par `play` (comme `ALLOWED_STREAM_SCHEMES` sous Windows). */
    val STREAM_SCHEMES = setOf("http", "https", "rtmp", "rtmps", "rtsp", "rtsps")

    /** Longueur maximale d'un `userAgent` (même borne que sous Windows). */
    const val MAX_USER_AGENT_LENGTH = 300

    /**
     * Propriétés que la page lit (`get_property`) : celles de l'interface du lecteur
     * (`useMpvObserver.ts`, `usePlayerPreferences.ts`, `usePlayerActions.ts`, `mpvBridge.ts`) et
     * celles que le moteur suit lui-même. `fullscreen` et `engine` sont tenues par le plugin. Un test
     * vérifie que chaque propriété lue par la page figure ici.
     */
    val READABLE_PROPERTIES = setOf(
        "fullscreen", "engine",
        "pause", "time-pos", "duration", "volume", "mute", "speed", "seeking", "paused-for-cache",
        "core-idle", "idle-active", "eof-reached", "aid", "sid", "sub-scale", "track-list", "filename",
        "media-title", "video-params", "video-codec", "audio-codec-name", "audio-params",
        "container-fps", "video-bitrate", "audio-bitrate", "frame-drop-count",
        "decoder-frame-drop-count", "demuxer-cache-state", "hwdec-current",
    )

    /**
     * Adresse de flux réseau (`http://…`, `rtmp://…`) ; jamais `file://`, `fd://`, `lavfi://`,
     * `memory://`…, ni de caractère de contrôle (un retour à la ligne pourrait finir dans la requête).
     */
    fun isAllowedStreamUrl(url: String): Boolean {
        if (url.any { it.isISOControl() }) return false
        val separator = url.indexOf("://")
        if (separator <= 0 || separator + 3 >= url.length) return false
        return url.substring(0, separator).lowercase() in STREAM_SCHEMES
    }

    /**
     * `userAgent` absent, ou court et sans caractère de contrôle : un retour à la ligne y ajoutait
     * des en-têtes HTTP choisis par la page aux requêtes du flux.
     */
    fun isAllowedUserAgent(userAgent: String?): Boolean =
        userAgent == null || (userAgent.length <= MAX_USER_AGENT_LENGTH && userAgent.none { it.isISOControl() })

    fun isReadableProperty(name: String): Boolean = name in READABLE_PROPERTIES
}
