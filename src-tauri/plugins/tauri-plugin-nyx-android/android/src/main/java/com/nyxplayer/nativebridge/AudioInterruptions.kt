package com.nyxplayer.nativebridge

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler

/**
 * Interruptions du son venues du système, traduites pour le moteur (fil principal uniquement) :
 * - focus audio : un appel, l'Assistant ou une autre app demande le son ;
 * - « écouteurs débranchés » (téléphone seulement) : le son passerait sur le haut-parleur.
 *
 * Les décisions (pause, reprise…) sont dans [AudioFocusPolicy] ; cette classe ne fait que parler
 * à Android.
 */
internal class AudioInterruptions(
    context: Context,
    handler: Handler,
    private val pauseWhenNoisy: Boolean,
    private val onFocusLoss: (transient: Boolean) -> Unit,
    private val onFocusGain: () -> Unit,
    private val onBecomingNoisy: () -> Unit,
) {
    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(AudioManager::class.java)

    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MOVIE)
                .build()
        )
        // Pendant un appel, Android répond « plus tard » puis rend le son à la fin de l'appel
        .setAcceptsDelayedFocusGain(true)
        .setOnAudioFocusChangeListener({ change -> onFocusChange(change) }, handler)
        .build()

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) onBecomingNoisy()
        }
    }
    private var noisyRegistered = false

    fun requestFocus(): AudioFocusPolicy.Request {
        val result = audioManager?.requestAudioFocus(focusRequest) ?: return AudioFocusPolicy.Request.FAILED
        return when (result) {
            AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> AudioFocusPolicy.Request.GRANTED
            AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> AudioFocusPolicy.Request.DELAYED
            else -> AudioFocusPolicy.Request.FAILED
        }
    }

    /** Rend le son aux autres apps (arrêt, arrière-plan) et arrête d'écouter les écouteurs. */
    fun release() {
        audioManager?.abandonAudioFocusRequest(focusRequest)
        stopWatchingNoisy()
    }

    /** Tant qu'un flux est ouvert : « écouteurs débranchés » met en pause (téléphone seulement). */
    fun watchNoisy() {
        if (!pauseWhenNoisy || noisyRegistered) return
        val filter = IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Diffusion du système : reçue même par un récepteur non exporté
            appContext.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            appContext.registerReceiver(noisyReceiver, filter)
        }
        noisyRegistered = true
    }

    private fun stopWatchingNoisy() {
        if (!noisyRegistered) return
        noisyRegistered = false
        runCatching { appContext.unregisterReceiver(noisyReceiver) }
    }

    private fun onFocusChange(change: Int) {
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> onFocusGain()
            AudioManager.AUDIOFOCUS_LOSS -> onFocusLoss(false)
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> onFocusLoss(true)
            // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK : Android 8+ baisse le son de l'app lui-même
        }
    }
}
