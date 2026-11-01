package com.nyxplayer.nativebridge

/**
 * Regroupement des messages de log identiques (chiffres mis à part). Un changement de décodeur en
 * cours de flux (Dolby Vision) fait cracher ~400 lignes/s par FFmpeg (« Could not find ref with POC
 * … ») : tout journaliser coûte du CPU au pire moment. Un même message ne réapparaît qu'après
 * [windowMs], avec le nombre d'occurrences masquées. Pas thread-safe : un seul fil (événements libmpv).
 */
internal class LogRepeatFilter(
    private val windowMs: Long = 2_000L,
    private val maxKeys: Int = 200,
) {
    private class Seen(val lastLoggedAt: Long, var suppressed: Int = 0)

    private val seen = HashMap<String, Seen>()

    /** La ligne à journaliser (« prefix: message », suivie du nombre masqué), ou null si elle est masquée. */
    fun admit(prefix: String, line: String, nowMs: Long): String? {
        val key = "$prefix|${line.replace(DIGITS, "#")}"
        val previous = seen[key]
        if (previous != null && nowMs - previous.lastLoggedAt < windowMs) {
            previous.suppressed++
            return null
        }
        val suffix = if (previous != null && previous.suppressed > 0) " (+${previous.suppressed} identiques)" else ""
        // Flux corrompu = messages toujours différents : la table ne doit pas gonfler sans fin
        if (seen.size > maxKeys) seen.clear()
        seen[key] = Seen(nowMs)
        return "$prefix: $line$suffix"
    }

    private companion object {
        val DIGITS = Regex("""\d+""")
    }
}
