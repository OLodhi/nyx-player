package com.nyxplayer.nativebridge

import com.nyxplayer.nativebridge.AudioFocusPolicy.Action
import com.nyxplayer.nativebridge.AudioFocusPolicy.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Appel, Assistant, autre app : ce que fait le lecteur quand Android reprend puis rend le son. */
class AudioFocusPolicyTest {
    private val policy = AudioFocusPolicy(liveResyncAfterMs = 30_000)

    @Test
    fun `un appel qui sonne met en pause, la fin de l'appel relance`() {
        assertEquals(Action.NONE, policy.onPlayRequested(Request.GRANTED, 0))
        assertEquals(Action.PAUSE, policy.onLoss(transient = true, playing = true, nowMs = 1_000))
        assertTrue(policy.resumePending)
        assertEquals(Action.RESUME, policy.onGain(live = false, nowMs = 600_000))
        assertFalse(policy.resumePending)
    }

    @Test
    fun `un direct en pause peu de temps reprend, longtemps il repart au direct`() {
        policy.onLoss(transient = true, playing = true, nowMs = 0)
        assertEquals(Action.RESUME, policy.onGain(live = true, nowMs = 5_000))

        policy.onLoss(transient = true, playing = true, nowMs = 100_000)
        assertEquals(Action.RELOAD_LIVE, policy.onGain(live = true, nowMs = 130_000))
    }

    @Test
    fun `une pause choisie par l'utilisateur ne repart jamais toute seule`() {
        assertEquals(Action.NONE, policy.onLoss(transient = true, playing = false, nowMs = 0))
        assertEquals(Action.NONE, policy.onGain(live = false, nowMs = 1_000))
    }

    @Test
    fun `l'utilisateur qui met en pause pendant l'appel garde la main`() {
        policy.onLoss(transient = true, playing = true, nowMs = 0)
        policy.reset()
        assertEquals(Action.NONE, policy.onGain(live = false, nowMs = 1_000))
    }

    @Test
    fun `une autre app qui prend le son met en pause sans reprise`() {
        assertEquals(Action.PAUSE, policy.onLoss(transient = false, playing = true, nowMs = 0))
        assertEquals(Action.NONE, policy.onGain(live = false, nowMs = 1_000))
    }

    @Test
    fun `une perte durable pendant un appel annule la reprise`() {
        policy.onLoss(transient = true, playing = true, nowMs = 0)
        assertEquals(Action.NONE, policy.onLoss(transient = false, playing = false, nowMs = 1_000))
        assertEquals(Action.NONE, policy.onGain(live = false, nowMs = 2_000))
    }

    @Test
    fun `lecture demandee pendant un appel - en pause jusqu'a la fin de l'appel`() {
        assertEquals(Action.PAUSE, policy.onPlayRequested(Request.DELAYED, 0))
        assertTrue(policy.resumePending)
        assertEquals(Action.RESUME, policy.onGain(live = false, nowMs = 10_000))
    }

    @Test
    fun `un refus du systeme ne bloque jamais la lecture`() {
        assertEquals(Action.NONE, policy.onPlayRequested(Request.FAILED, 0))
        assertFalse(policy.resumePending)
    }

    @Test
    fun `deux pertes de suite - le temps de pause part de la premiere`() {
        policy.onLoss(transient = true, playing = true, nowMs = 0)
        // Deuxième perte (Assistant pendant la sonnerie) : le lecteur est déjà en pause
        assertEquals(Action.NONE, policy.onLoss(transient = true, playing = false, nowMs = 25_000))
        assertEquals(Action.RELOAD_LIVE, policy.onGain(live = true, nowMs = 31_000))
    }

    @Test
    fun `une nouvelle lecture accordee efface une reprise en attente`() {
        policy.onLoss(transient = true, playing = true, nowMs = 0)
        policy.onPlayRequested(Request.GRANTED, 1_000)
        assertEquals(Action.NONE, policy.onGain(live = false, nowMs = 2_000))
    }
}
