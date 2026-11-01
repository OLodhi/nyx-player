/**
 * useFlashIcon.ts — Icône lecture / pause affichée brièvement au centre de l'écran quand la lecture
 * est lancée ou mise en pause au clavier ou d'un toucher.
 */

import { useState, useRef, useCallback } from 'react';

const FLASH_MS = 500;

export function useFlashIcon(isPaused: boolean) {
  const [flashIcon, setFlashIcon] = useState<'play' | 'pause' | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashPlayPause = useCallback(() => {
    // Icône inverse : ce qui va se passer après le basculement
    setFlashIcon(isPaused ? 'play' : 'pause');
    setFlashKey(k => k + 1);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashIcon(null), FLASH_MS);
  }, [isPaused]);

  return { flashIcon, flashKey, flashPlayPause };
}
