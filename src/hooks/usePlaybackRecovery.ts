/**
 * usePlaybackRecovery — Lecture rétablie après une reconnexion automatique.
 *
 * Le compteur de relances (PlayerContext) ne repart à zéro que si la vidéo a vraiment
 * défilé RECOVERY_PLAYBACK_S secondes depuis la dernière relance. Un flux qui s'ouvre puis
 * reste bloqué en mise en tampon ne compte pas : le compteur continue de monter jusqu'à
 * l'écran « abandon » au lieu de relancer le fournisseur indéfiniment.
 */

import { useEffect, useRef } from 'react';
import { RECOVERY_PLAYBACK_S } from '../services/player/playbackErrors';

/** Au-delà, l'écart de position est un saut (seek, nouveau flux) et pas de la lecture */
const MAX_PROGRESS_STEP_S = 2;

export function usePlaybackRecovery(
  currentTime: number,
  retryAttempt: number,
  hasError: boolean,
  onRecovered: () => void,
): void {
  const playedRef = useRef(0);
  const lastPosRef = useRef<number | null>(null);
  const onRecoveredRef = useRef(onRecovered);

  useEffect(() => {
    onRecoveredRef.current = onRecovered;
  }, [onRecovered]);

  // Chaque relance (ou erreur) recommence la mesure
  useEffect(() => {
    playedRef.current = 0;
    lastPosRef.current = null;
  }, [retryAttempt, hasError]);

  useEffect(() => {
    if (retryAttempt === 0 || hasError) return;
    const last = lastPosRef.current;
    lastPosRef.current = currentTime;
    if (last === null) return;

    const delta = currentTime - last;
    if (delta <= 0 || delta > MAX_PROGRESS_STEP_S) return;

    playedRef.current += delta;
    if (playedRef.current >= RECOVERY_PLAYBACK_S) {
      playedRef.current = 0;
      onRecoveredRef.current();
    }
  }, [currentTime, retryAttempt, hasError]);
}
