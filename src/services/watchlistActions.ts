/**
 * Bouton « Ma liste » (accueil, cartes, fiches) : ajout ou retrait, avec un message bref quand
 * l'écriture échoue (base occupée, par exemple pendant une mise à jour du catalogue sur le
 * Chromecast, ou fermée pendant un changement de compte). Avant, l'appui restait sans effet ni
 * message (un message bref suffit).
 */

import { isInWatchlist, toggleWatchlist } from './watchlistHydration';
import { showAppNotice } from '../utils/appNotice';
import { createLogger } from '../utils/logger';

const log = createLogger('Watchlist');

/**
 * Nouvel état (dans Ma liste ou non). En cas d'échec, message affiché et état relu dans la base
 * (une écriture partielle a pu passer) ; null si même la relecture échoue.
 */
export async function toggleWatchlistOrNotify(
  streamId: number,
  tmdbId: number,
  type: 'movie' | 'series',
): Promise<boolean | null> {
  try {
    return await toggleWatchlist(streamId, tmdbId, type);
  } catch (e) {
    log.error('Ma liste non modifiée :', e);
    showAppNotice('watchlist_update_failed');
    try {
      return await isInWatchlist(streamId, tmdbId, type);
    } catch {
      return null;
    }
  }
}
