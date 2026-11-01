/**
 * watchlistPush.ts — Envois immédiats de Ma liste vers le cloud (fire-and-forget)
 */

import { supabase } from '../../supabaseClient';
import { canSync, getCurrentSyncUserId } from '../syncState';
import { getLastProviderHash } from '../../preferencesService';
import { devLog } from '../../../utils/devLog';
import { watchlistKey, currentGeneration } from '../syncBaseline';
import { afterSend } from './afterSend';
import { sendInBackground } from './sendInBackground';
import { placeWatchlistTitles } from './watchlistPlacement';
import type { WatchlistPlacement } from './watchlistPlacement';
import { createLogger } from '../../../utils/logger';

const log = createLogger('Sync');

/**
 * Retrait immédiat d'un titre de Ma liste dans le cloud (fire-and-forget).
 * Appelé par watchlistHydration.removeFromWatchlist(). Un titre TMDB est retiré par titre, toutes
 * ses lignes, comme en local : un numéro provisoire négatif ou un doublon d'un ancien fournisseur
 * ne le fait plus revenir. Une ligne sans TMDB est retirée par numéro.
 */
export function pushWatchlistDeleteToCloud(
  streamId: number,
  type: 'movie' | 'series',
  tmdbId = 0
): void {
  if (!canSync()) return;
  if (tmdbId <= 0 && streamId <= 0) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('watchlist');
  let query = supabase
    .from('user_watchlist')
    .delete()
    .eq('user_id', userId)
    .eq('media_type', type);
  query = tmdbId > 0 ? query.eq('tmdb_id', tmdbId) : query.eq('stream_id', streamId);
  sendInBackground(query, 'watchlist delete', () => {
    devLog('sync', `Watchlist removed from cloud: ${tmdbId > 0 ? `tmdb_id=${tmdbId}` : `stream_id=${streamId}`}`);
    return afterSend(userId, 'watchlist', generation, { remove: [watchlistKey(tmdbId, streamId, type)] });
  });
}

/**
 * Fire-and-forget : ajout immédiat d'un titre de Ma liste dans le cloud.
 * Appelé par watchlistHydration.addToWatchlist() après chaque ajout local. Un titre TMDB est placé
 * par titre (placeWatchlistTitles) : sa ligne existante est déplacée au numéro local, et la ligne
 * d'un autre titre n'est jamais écrasée. Includes current provider_hash.
 */
export function pushWatchlistUpsertToCloud(
  streamId: number,
  tmdbId: number,
  type: 'movie' | 'series'
): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('watchlist');
  const providerHash = getLastProviderHash();
  const key = watchlistKey(tmdbId, streamId, type);
  if (tmdbId > 0) {
    placeWatchlistTitles(
      userId,
      [{ tmdb_id: tmdbId, media_type: type, stream_id: streamId, provider_hash: providerHash }],
      () => void afterSend(userId, 'watchlist', generation, { set: [[key, 0]] }),
    ).catch((err) => log.warn('Fire-and-forget watchlist add failed:', err));
    return;
  }
  if (streamId <= 0) return;
  sendInBackground(
    supabase
      .from('user_watchlist')
      .upsert(
        { user_id: userId, stream_id: streamId, tmdb_id: tmdbId, media_type: type, provider_hash: providerHash },
        { onConflict: 'user_id,stream_id,media_type' }
      ),
    'watchlist upsert',
    () => afterSend(userId, 'watchlist', generation, { set: [[key, 0]] }),
  );
}

/**
 * Batch UPDATE of re-linked watchlist items in Supabase.
 * Called after re-link pass to push updated stream_id + provider_hash to cloud.
 * Les numéros croisés et les titres absents du cloud sont gérés par placeWatchlistTitles.
 */
export async function pushWatchlistUpdates(
  items: WatchlistPlacement[],
  /** Compte connecté quand Ma liste a été lue : si un autre compte l'a remplacé depuis, rien ne part */
  expectedUserId?: string | null
): Promise<void> {
  if (!canSync() || items.length === 0) return;
  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('watchlist');
  if (expectedUserId !== undefined && expectedUserId !== userId) return;
  await placeWatchlistTitles(userId, items, (item) => {
    void afterSend(userId, 'watchlist', generation, { set: [[watchlistKey(item.tmdb_id, item.stream_id, item.media_type), 0]] });
  });
}
