/**
 * usePeriodicSave.ts — Sauvegarde périodique crash-resilient
 *
 * Sauvegarde la progression de lecture toutes les 30 secondes.
 * Utilise un useRef pour éviter de recréer l'intervalle à chaque
 * mise à jour de currentTime (pattern anti-stale closure).
 */

import { useEffect, useRef } from 'react';
import { updateProgress } from '../services/playbackProgressService';
import { createLogger } from '../utils/logger';

const log = createLogger('usePeriodicSave');

export function usePeriodicSave(
  contentId: string | undefined,
  isConnected: boolean,
  duration: number,
  currentTime: number,
): void {
  const currentTimeRef = useRef(0);
  const durationRef = useRef(duration);

  // Sync refs on every render (no deps array = every render)
  useEffect(() => {
    currentTimeRef.current = currentTime;
    durationRef.current = duration;
  });

  // Intervalle stable : la durée est lue dans une référence. Avant, chaque durée affinée par mpv
  // relançait les 30 s, et la sauvegarde pouvait ne jamais partir.
  const hasDuration = duration > 0;
  useEffect(() => {
    if (!contentId || !isConnected || !hasDuration) return;

    const interval = setInterval(() => {
      const time = currentTimeRef.current;
      const total = durationRef.current;
      if (time > 10 && total > 0) {
        updateProgress(Number(contentId), time, total)
          .catch(e => log.warn('Periodic save failed:', e));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [contentId, isConnected, hasDuration]);
}
