package com.nyxplayer.nativebridge

/**
 * Réglages du lecteur demandés par l'interface, traduits en propriétés mpv, sans appel Android
 * (testés sur la JVM, PlayerSettingsTest). MpvEngine se contente de les appliquer.
 */
internal object PlayerSettings {
    /** Piste son (`aid`) ou sous-titres (`sid`, pour tout autre type). */
    fun trackProperty(type: String): String = if (type == "audio") "aid" else "sid"

    /** id < 0 : retour au choix automatique de mpv (chaîne en direct après un film, mpvBridge.ts) ; 0 : aucune piste. */
    fun trackValue(id: Int): String = when {
        id < 0 -> "auto"
        id == 0 -> "no"
        else -> id.toString()
    }

    /** Format de l'image : `keepaspect` et `panscan` de mpv. */
    data class Resize(val keepAspect: String, val panscan: Double)

    /** « fill » remplit l'écran en rognant, « stretch » déforme ; tout autre mode garde l'image entière. */
    fun resize(mode: String): Resize = when (mode) {
        "fill" -> Resize("yes", 1.0)
        "stretch" -> Resize("no", 0.0)
        else -> Resize("yes", 0.0)
    }

    fun volume(value: Double): Double = value.coerceIn(0.0, 100.0)

    fun speed(value: Double): Double = value.coerceIn(0.25, 4.0)

    fun subtitleScale(value: Double): Double = value.coerceIn(0.3, 3.0)
}
