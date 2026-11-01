import { useEffect, useState } from 'react';
import { getContinueWatching, PlaybackProgressItem } from '../services/playbackProgressService';
import { PLAYBACK_EVENT } from '../services/eventConstants';
import { createLogger } from '../utils/logger';

const log = createLogger('Dashboard');

// Cache module-level pour retour instantané au Dashboard
let cachedContinueWatching: PlaybackProgressItem[] = [];

interface UseContinueWatchingReturn {
  continueWatching: PlaybackProgressItem[];
}

/**
 * Gère le chargement et la mise à jour de "Reprendre la lecture" depuis SQLite.
 * Écoute l'event `playbackPositionUpdated` pour rafraîchir automatiquement.
 * Extrait de DashboardPage (Phase 3A.3).
 */
export function useContinueWatching(): UseContinueWatchingReturn {
  const [continueVersion, setContinueVersion] = useState(0);
  const [continueWatching, setContinueWatching] = useState<PlaybackProgressItem[]>(cachedContinueWatching);

  // Écouter les mises à jour de position de lecture
  useEffect(() => {
    const handlePlaybackUpdate = () => {
      setContinueVersion((prev) => prev + 1);
    };

    window.addEventListener(PLAYBACK_EVENT, handlePlaybackUpdate);

    return () => {
      window.removeEventListener(PLAYBACK_EVENT, handlePlaybackUpdate);
    };
  }, []);

  // Charger depuis SQLite
  useEffect(() => {
    getContinueWatching()
      .then((items) => {
        setContinueWatching(items);
        cachedContinueWatching = items;
      })
      .catch((e) => log.error('Failed to load continue watching:', e));
  }, [continueVersion]);

  return { continueWatching };
}
