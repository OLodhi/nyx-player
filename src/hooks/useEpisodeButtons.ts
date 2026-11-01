/**
 * useEpisodeButtons.ts — Épisode précédent / suivant depuis le lecteur.
 *
 * La position de lecture est enregistrée avant de changer d'épisode. La fonction d'enregistrement
 * vient de `usePlayerPreferences`, appelé après : elle est donc passée par `savePlaybackPositionRef`,
 * que le lecteur tient à jour.
 */

import { useCallback, useRef } from 'react';
import { devLog } from '../utils/devLog';

export function useEpisodeButtons(onNextEpisode?: () => void, onPrevEpisode?: () => void) {
  const savePlaybackPositionRef = useRef<() => Promise<void> | undefined>(() => undefined);

  const handleNextEpisode = useCallback(async () => {
    if (!onNextEpisode) return;
    try {
      await savePlaybackPositionRef.current?.();
    } catch (e) {
      devLog('player', '[PlayerControls] Failed to save position before next:', e);
    }
    onNextEpisode();
  }, [onNextEpisode]);

  const handlePrevEpisode = useCallback(async () => {
    if (!onPrevEpisode) return;
    try {
      await savePlaybackPositionRef.current?.();
    } catch (e) {
      devLog('player', '[PlayerControls] Failed to save position before prev:', e);
    }
    onPrevEpisode();
  }, [onPrevEpisode]);

  return { handleNextEpisode, handlePrevEpisode, savePlaybackPositionRef };
}
