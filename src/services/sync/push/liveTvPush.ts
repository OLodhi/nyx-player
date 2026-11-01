/**
 * liveTvPush.ts — Envois immédiats des favoris et catégories épinglées Live TV (fire-and-forget)
 */

import { supabase } from '../../supabaseClient';
import { canSync, getCurrentSyncUserId } from '../syncState';
import { getLastProviderHash } from '../../preferencesService';
import { currentGeneration } from '../syncBaseline';
import { afterSend } from './afterSend';
import { sendInBackground } from './sendInBackground';
import { fitsCloudProviderId } from '../cloudLimits';

/**
 * Hard DELETE immédiat d'un bookmark Live TV de Supabase (fire-and-forget).
 * Appelé par liveTvBookmarksService quand on retire un favori ou une catégorie épinglée.
 * Si offline ou erreur, la synchro suivante retire l'élément du cloud (dernier accord, syncBaseline.ts).
 */
export function pushLiveTvBookmarkDeleteToCloud(
  bookmarkType: 'favorite' | 'pinned_category',
  itemId: string
): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('livetv');
  sendInBackground(
    supabase
      .from('user_livetv_bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('bookmark_type', bookmarkType)
      .eq('item_id', itemId),
    'liveTv bookmark delete',
    () => afterSend(userId, 'livetv', generation, { remove: [`${bookmarkType}::${itemId}`] }),
  );
}

/**
 * Fire-and-forget upsert immédiat d'un bookmark Live TV vers Supabase.
 * Appelé par liveTvBookmarksService.toggleFavorite() / togglePinnedCategory() après chaque ajout.
 */
export function pushLiveTvBookmarkUpsertToCloud(
  bookmarkType: 'favorite' | 'pinned_category',
  itemId: string
): void {
  // Numéro démesuré : gardé sur l'appareil, jamais envoyé (la base le refuserait)
  if (!canSync() || !fitsCloudProviderId(itemId)) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('livetv');
  sendInBackground(
    supabase
      .from('user_livetv_bookmarks')
      .upsert(
        { user_id: userId, bookmark_type: bookmarkType, item_id: itemId, provider_hash: getLastProviderHash() },
        { onConflict: 'user_id,bookmark_type,item_id' }
      ),
    'liveTv bookmark upsert',
    () => afterSend(userId, 'livetv', generation, { set: [[`${bookmarkType}::${itemId}`, 0]] }),
  );
}
