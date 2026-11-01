import { useEffect, useState, useCallback } from 'react';
import { getHydratedWatchlist, HydratedWatchlistItem, onWatchlistChange } from '../services/watchlistHydration';
import { toggleWatchlistOrNotify } from '../services/watchlistActions';
import { onDetailsUpdate } from '../services/tmdbCacheSqlite';
import type { LightIndexes } from '../types/lightIndex';
import { createLogger } from '../utils/logger';

const log = createLogger('Watchlist');

// Cache module-level pour retour instantané au Dashboard
let cachedWatchlist: HydratedWatchlistItem[] = [];

interface UseWatchlistDataReturn {
  watchlist: HydratedWatchlistItem[];
  handleWatchlistToggle: (streamId: number, tmdbId: number, type: 'movie' | 'series') => Promise<void>;
}

/**
 * Gère le chargement, la mise à jour et le toggle de la watchlist.
 * Écoute les events `onWatchlistChange` et `onDetailsUpdate` pour rafraîchir.
 * Extrait de DashboardPage (Phase 3A.4).
 */
export function useWatchlistData(lightIndexes: LightIndexes | undefined): UseWatchlistDataReturn {
  const [watchlistVersion, setWatchlistVersion] = useState(0);
  const [watchlist, setWatchlist] = useState<HydratedWatchlistItem[]>(cachedWatchlist);

  const handleWatchlistToggle = useCallback(async (
    streamId: number,
    tmdbId: number,
    type: 'movie' | 'series'
  ) => {
    // Échec complet : message affiché, rien à recharger
    if (await toggleWatchlistOrNotify(streamId, tmdbId, type) === null) return;
    setWatchlistVersion((prev) => prev + 1);
  }, []);

  // Charger la watchlist depuis SQLite. Chaque changement relance un chargement : seul le plus
  // récent s'applique, une réponse arrivée en retard ne remplace pas la liste à jour.
  useEffect(() => {
    if (!lightIndexes) return;
    let stale = false;
    getHydratedWatchlist(lightIndexes)
      .then((items) => {
        if (stale) return;
        setWatchlist(items);
        cachedWatchlist = items;
      })
      .catch((err) => log.warn('Chargement de Ma liste en échec :', err));
    return () => { stale = true; };
  }, [watchlistVersion, lightIndexes]);

  // Subscribe to watchlist changes from any component
  useEffect(() => {
    return onWatchlistChange(() => {
      setWatchlistVersion((v) => v + 1);
    });
  }, []);

  // Subscribe to TMDB cache updates (when visiting detail page fills cache)
  useEffect(() => {
    return onDetailsUpdate(() => {
      setWatchlistVersion((v) => v + 1);
    });
  }, []);

  return { watchlist, handleWatchlistToggle };
}
