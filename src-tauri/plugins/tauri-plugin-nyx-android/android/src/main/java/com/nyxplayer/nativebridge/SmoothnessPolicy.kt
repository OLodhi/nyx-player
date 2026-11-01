package com.nyxplayer.nativebridge

/**
 * L'appareil suit-il la vidéo ? Règles sans appel Android (testées sur la JVM, SmoothnessPolicyTest).
 *
 * Chromecast : un Dolby Vision 5 en 4K décodé au processeur faisait ralentir image ET son
 * (coupures du son), avec peu d'images « perdues ». Trois signaux, mesurés par fenêtres en lecture
 * continue (ni pause, ni mise en tampon, ni saut) : images perdues, vidéo qui avance moins vite que
 * l'horloge, son qui décroche. Mauvaise fenêtre : plus de 15 % d'images perdues, vidéo à moins de
 * 85 % de la vitesse de l'horloge, ou son qui décroche 3 fois. Deux mauvaises de suite, ou une très
 * mauvaise (plus de 50 % perdues, ou moins de la moitié de la vitesse) : l'appareil ne suit pas.
 */
internal object SmoothnessPolicy {
    private const val DROP_RATIO_BAD = 0.15
    private const val DROP_RATIO_FATAL = 0.5
    private const val PROGRESS_BAD = 0.85
    private const val PROGRESS_FATAL = 0.5
    private const val AUDIO_TROUBLE_BAD = 3
    /** Fenêtre trop courte pour juger (relevé pris juste après le précédent) */
    private const val MIN_WINDOW_SECONDS = 2.0

    /** Relevé de fin de fenêtre. [playing] : lecture continue pendant toute la fenêtre. */
    data class Sample(val drops: Long, val position: Double, val wallMs: Long, val audioTrouble: Int, val playing: Boolean)

    /** Fenêtre jugée : vitesse de la vidéo par rapport à l'horloge, part d'images perdues, décrochages du son. */
    data class Window(val progress: Double, val dropRatio: Double, val audioTrouble: Int) {
        val bad: Boolean get() = dropRatio > DROP_RATIO_BAD || progress < PROGRESS_BAD || audioTrouble >= AUDIO_TROUBLE_BAD
        val fatal: Boolean get() = dropRatio > DROP_RATIO_FATAL || progress < PROGRESS_FATAL
    }

    /**
     * Fenêtre entre deux relevés, ou null si elle ne se juge pas (premier relevé, lecture
     * interrompue, fenêtre trop courte, position revenue en arrière). [speed] et [fps] : valeurs
     * mpv, null si inconnues.
     */
    fun judge(previous: Sample?, sample: Sample, speed: Double?, fps: Double?): Window? {
        if (previous == null || !previous.playing || !sample.playing) return null
        val wall = (sample.wallMs - previous.wallMs) / 1000.0
        val played = sample.position - previous.position
        if (wall < MIN_WINDOW_SECONDS || !(played >= 0)) return null
        val effectiveSpeed = (speed ?: 1.0).coerceAtLeast(0.1)
        val effectiveFps = (fps ?: 24.0).coerceAtLeast(1.0)
        val dropRatio = if (played > 0.5) (sample.drops - previous.drops) / (played * effectiveFps) else 0.0
        return Window(played / (wall * effectiveSpeed), dropRatio, sample.audioTrouble - previous.audioTrouble)
    }

    /** Mauvaises fenêtres consécutives après celle-ci. */
    fun badWindowsAfter(window: Window, badWindows: Int): Int = if (window.bad) badWindows + 1 else 0

    /** L'appareil ne suit pas : une très mauvaise fenêtre, ou deux mauvaises de suite. */
    fun tooSlow(window: Window, badWindows: Int): Boolean = window.fatal || badWindows >= 2

    /**
     * Format décodé, sans adresse : « hevc|2160|sw|dv5 ». Clé de la mémoire « trop lourd pour cet
     * appareil » (prévenir dès le début la fois suivante).
     */
    fun formatSignature(codec: String, height: Int, hwdecCurrent: String?, dolbyVision: Boolean): String {
        val band = when {
            height >= 2000 -> "2160"
            height >= 1000 -> "1080"
            else -> "sd"
        }
        val hw = if ((hwdecCurrent ?: "no") == "no") "sw" else "hw"
        return listOf(codec.lowercase(), band, hw, if (dolbyVision) "dv5" else "").filter { it.isNotEmpty() }.joinToString("|")
    }

    /** Détail lisible du message : « HEVC · 3840x1920 · Dolby Vision 5 · software ». */
    fun formatDetail(codec: String?, width: Int?, height: Int?, hwdecCurrent: String?, dolbyVision: Boolean): String {
        val size = listOfNotNull(width, height).joinToString("x")
        val hw = if ((hwdecCurrent ?: "no") == "no") "software" else "hardware"
        return listOf(codec?.uppercase() ?: "", size, if (dolbyVision) "Dolby Vision 5" else "", hw)
            .filter { it.isNotBlank() }.joinToString(" · ")
    }
}
