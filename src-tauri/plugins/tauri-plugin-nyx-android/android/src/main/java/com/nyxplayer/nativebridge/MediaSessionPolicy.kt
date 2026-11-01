package com.nyxplayer.nativebridge

import android.media.session.PlaybackState

/**
 * Ce que la MediaSession annonce à Android et comment ses commandes se traduisent pour le lecteur.
 * Sans appel Android (les constantes `PlaybackState.*` sont recopiées à la compilation), pour être
 * testée sur la JVM (MediaSessionPolicyTest).
 *
 * Qui envoie ces commandes : l'Assistant (« Ok Google, pause »), les boutons d'un casque ou
 * d'écouteurs Bluetooth, les touches média d'une télécommande que la page n'a pas traitées.
 *
 * - Toujours : lecture, pause, lecture/pause, arrêt (traité comme une pause : rien ne se ferme
 *   sans que l'utilisateur le voie).
 * - Film ou épisode : aller à une position, avance et recul rapides (10 s, comme la télécommande).
 * - Direct : chaîne suivante / précédente (l'interface choisit la chaîne), pas de déplacement.
 * - Flux en cours d'ouverture (direct ou non : inconnu) : lecture et pause seulement.
 */
internal object MediaSessionPolicy {
    enum class Kind { OPENING, LIVE, VOD }

    /** Même pas que la télécommande dans le lecteur (REMOTE_SEEK_SECONDS, usePlayerRemote.ts). */
    const val SEEK_STEP_SECONDS = 10.0

    private const val BASE_ACTIONS = PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or
        PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP

    /**
     * Un film ou un épisode dont le fournisseur n'annonce pas la durée reste un film (même règle que
     * la reprise de position, [PlaybackPolicy.isLive]) : les boutons du casque avancent de 10 s au
     * lieu de changer de chaîne.
     */
    fun kind(fileLoaded: Boolean, duration: Double, url: String): Kind = when {
        !fileLoaded -> Kind.OPENING
        PlaybackPolicy.isLive(url, duration) -> Kind.LIVE
        else -> Kind.VOD
    }

    fun actions(kind: Kind): Long = when (kind) {
        Kind.OPENING -> BASE_ACTIONS
        Kind.VOD -> BASE_ACTIONS or PlaybackState.ACTION_SEEK_TO or
            PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND
        Kind.LIVE -> BASE_ACTIONS or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS
    }

    /**
     * « En lecture » dès que l'utilisateur n'a pas mis en pause, même pendant une mise en mémoire
     * tampon (ouverture, réseau lent) : pour Android, seul STATE_PLAYING fait d'un appui sur
     * lecture/pause d'un casque une pause. Annoncer BUFFERING le transformait en « lecture » (sans
     * effet) : l'appui était perdu. La mise en tampon se traduit par une vitesse nulle ([speed]).
     */
    fun state(paused: Boolean): Int = if (paused) PlaybackState.STATE_PAUSED else PlaybackState.STATE_PLAYING

    /** Vitesse annoncée : nulle en pause et en mise en tampon, pour que la position ne dérive pas. */
    fun speed(paused: Boolean, buffering: Boolean, speed: Double): Float =
        if (paused || buffering) 0f else speed.toFloat()

    /** Position annoncée en millisecondes : inconnue en direct et pendant l'ouverture. */
    fun positionMs(kind: Kind, timePos: Double): Long =
        if (kind == Kind.VOD) (timePos.coerceAtLeast(0.0) * 1000).toLong() else PlaybackState.PLAYBACK_POSITION_UNKNOWN

    /**
     * « Aller à » (Assistant : « avance de 2 minutes ») en secondes, gardé dans le film : un peu avant
     * la fin plutôt qu'au-delà (le lecteur finirait le film). Durée inconnue : seulement pas avant le
     * début. Null : rien à faire (direct, ouverture).
     */
    fun seekTarget(kind: Kind, targetMs: Long, duration: Double): Double? {
        if (kind != Kind.VOD) return null
        if (duration <= 0.0) return (targetMs / 1000.0).coerceAtLeast(0.0)
        val end = (duration - END_MARGIN_SECONDS).coerceAtLeast(0.0)
        return (targetMs / 1000.0).coerceIn(0.0, end)
    }

    /** Un film se termine plutôt que de sauter au-delà : même marge que « aller à ». */
    private const val END_MARGIN_SECONDS = 1.0
}
