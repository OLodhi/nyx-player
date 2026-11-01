package com.nyxplayer.nativebridge

/**
 * Décisions du lecteur quand Android donne ou reprend le son (focus audio) : appel, Assistant,
 * autre app qui joue du son. Sans dépendance Android, pour être testée sur la JVM
 * (AudioFocusPolicyTest).
 *
 * - Perte passagère (appel qui sonne, Assistant) : pause, puis reprise quand le son revient.
 * - Perte durable (une autre app lance sa musique) : pause, sans reprise automatique.
 * - « Baisser le volume » (notification, GPS) : rien à faire, Android 8+ baisse le son lui-même.
 * - Un direct resté longtemps en pause repart au direct (rechargement), pas là où il s'était
 *   arrêté : c'est la même règle qu'au retour de l'arrière-plan.
 */
internal class AudioFocusPolicy(private val liveResyncAfterMs: Long = LIVE_RESYNC_AFTER_MS) {
    enum class Request { GRANTED, DELAYED, FAILED }
    enum class Action { NONE, PAUSE, RESUME, RELOAD_LIVE }

    /** Le lecteur a été mis en pause par le système et doit repartir au retour du son. */
    var resumePending = false
        private set
    private var pausedAtMs = 0L

    /**
     * Lecture demandée (nouveau flux, reprise, touche lecture). DELAYED : un appel est en cours,
     * Android rendra le son à la fin (le lecteur reste en pause jusque-là). FAILED : on joue quand
     * même, pour ne jamais bloquer la lecture sur un appareil qui refuse le focus sans raison.
     */
    fun onPlayRequested(result: Request, nowMs: Long): Action {
        if (result == Request.DELAYED) {
            markPaused(nowMs)
            return Action.PAUSE
        }
        resumePending = false
        return Action.NONE
    }

    /** L'utilisateur met en pause, arrête, change de flux : le système ne relance plus rien. */
    fun reset() {
        resumePending = false
    }

    fun onLoss(transient: Boolean, playing: Boolean, nowMs: Long): Action {
        if (!transient) {
            // Déjà en pause (par l'utilisateur ou par un appel) : on n'y touche pas, sans reprise
            resumePending = false
            return if (playing) Action.PAUSE else Action.NONE
        }
        if (!playing) return Action.NONE
        markPaused(nowMs)
        return Action.PAUSE
    }

    fun onGain(live: Boolean, nowMs: Long): Action {
        if (!resumePending) return Action.NONE
        resumePending = false
        return if (live && nowMs - pausedAtMs >= liveResyncAfterMs) Action.RELOAD_LIVE else Action.RESUME
    }

    private fun markPaused(nowMs: Long) {
        // Deuxième perte pendant la même pause : le décompte part de la première
        if (!resumePending) pausedAtMs = nowMs
        resumePending = true
    }

    companion object {
        /** Au-delà, un direct repris après une pause serait visiblement en retard : on recharge au direct. */
        const val LIVE_RESYNC_AFTER_MS = 30_000L
    }
}
