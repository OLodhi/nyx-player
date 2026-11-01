package com.nyxplayer.nativebridge

import android.app.Activity
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Handler
import android.os.SystemClock

/**
 * MediaSession du lecteur (fil principal uniquement) : sans elle, l'Assistant (« Ok Google,
 * pause »), les boutons d'un casque ou d'écouteurs Bluetooth et les touches média que la page n'a
 * pas traitées partaient vers une autre app (souvent celle de musique, qui se relançait).
 *
 * Active seulement tant qu'un flux est ouvert au premier plan : hors du lecteur et en arrière-plan
 * (flux fermé), Android rend ces touches aux autres apps comme avant.
 *
 * Ce qui est annoncé et comment les commandes se traduisent : [MediaSessionPolicy]. Cette classe
 * ne fait que parler à Android.
 */
internal class PlayerMediaSession(
    private val activity: Activity,
    handler: Handler,
    private val commands: Commands,
) {
    /** Commandes reçues, traduites par le moteur (fil principal). */
    interface Commands {
        fun onPlayCommand()
        fun onPauseCommand()
        fun onSeekCommand(positionMs: Long)
        fun onStepCommand(forward: Boolean)
        fun onSkipCommand(next: Boolean)
    }

    private val session = MediaSession(activity, "NyxPlayer").apply {
        setCallback(object : MediaSession.Callback() {
            override fun onPlay() = commands.onPlayCommand()
            override fun onPause() = commands.onPauseCommand()
            // « Arrête » : pause, le lecteur reste ouvert (MediaSessionPolicy)
            override fun onStop() = commands.onPauseCommand()
            override fun onSeekTo(pos: Long) = commands.onSeekCommand(pos)
            override fun onFastForward() = commands.onStepCommand(forward = true)
            override fun onRewind() = commands.onStepCommand(forward = false)
            override fun onSkipToNext() = commands.onSkipCommand(next = true)
            override fun onSkipToPrevious() = commands.onSkipCommand(next = false)
        }, handler)
    }

    private var lastDurationMs = -1L

    /**
     * Flux ouvert au premier plan : la session reçoit les commandes. L'activité la désigne aussi
     * comme cible des touches média qu'aucune vue n'a traitées (sinon Android choisit une autre app).
     */
    fun update(kind: MediaSessionPolicy.Kind, paused: Boolean, buffering: Boolean, timePos: Double, speed: Double, duration: Double) {
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(MediaSessionPolicy.actions(kind))
                .setState(
                    MediaSessionPolicy.state(paused),
                    MediaSessionPolicy.positionMs(kind, timePos),
                    MediaSessionPolicy.speed(paused, buffering, speed),
                    SystemClock.elapsedRealtime(),
                )
                .build()
        )
        // Durée : l'Assistant en a besoin pour « avance de 2 minutes » (film ou épisode seulement)
        val durationMs = if (kind == MediaSessionPolicy.Kind.VOD) (duration * 1000).toLong() else 0L
        if (durationMs != lastDurationMs) {
            lastDurationMs = durationMs
            session.setMetadata(
                MediaMetadata.Builder()
                    .apply { if (durationMs > 0) putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs) }
                    .build()
            )
        }
        if (!session.isActive) {
            session.isActive = true
            activity.mediaController = session.controller
        }
    }

    /** Plus de flux (arrêt, arrière-plan, échec) : les touches média reviennent aux autres apps. */
    fun deactivate() {
        if (!session.isActive) return
        session.isActive = false
        lastDurationMs = -1L
        if (activity.mediaController?.sessionToken == session.sessionToken) activity.mediaController = null
    }

    fun release() {
        deactivate()
        session.release()
    }
}
