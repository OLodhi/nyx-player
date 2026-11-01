/**
 * syncService.ts — Orchestrateur sync + barrel de ré-exports
 *
 * V1 : Sync au login (full merge) + push fire-and-forget immédiat après chaque écriture locale.
 *
 * Stratégie LWW (Last-Write-Wins) :
 * - Chaque item modifiable a un `updated_at` (ms epoch en SQLite, timestamptz en Supabase)
 * - Au merge, le timestamp le plus récent gagne
 * - Données add/remove-only (watchlist, liveTv) utilisent un merge ensembliste
 *
 * Tables sync :
 * 1. user_preferences (key/value, LWW)
 * 2. user_watchlist (films/séries, merge ensembliste)
 * 3. user_playback_progress (reprise lecture, LWW)
 * 4. user_livetv_bookmarks (favoris + catégories épinglées, merge ensembliste)
 * 5. user_hidden_categories (catégories masquées, merge ensembliste)
 */

import { setMeta } from '../dbCore';
import type { SyncResult } from './syncTypes';
import { syncPreferences } from './syncPreferences';
import { syncWatchlist } from './syncWatchlist';
import { syncPlayback } from './syncPlayback';
import { syncLiveTv } from './syncLiveTv';
import { syncHiddenCategories } from './syncHiddenCategories';
import { devLog } from '../../utils/devLog';
import { createLogger } from '../../utils/logger';
import { sanitizeIptvUrl } from '../../utils/sanitizeUrl';
import { isSameAccount } from './syncBaseline';
import { settlePendingProviderPurge } from './syncPurge';
import { clearCloudRefusal } from './cloudRefusal';

// ============================================================================
// RE-EXPORTS — Rétrocompatibilité avec tous les fichiers qui importent depuis syncService
// ============================================================================

export { setCurrentSyncUserId, canSync, getCurrentSyncUserId } from './syncState';
export { purgeCloudData, fetchCloudProviderHash, purgeProviderCloudData } from './syncPurge';
export {
  pushWatchlistDeleteToCloud,
  pushWatchlistUpsertToCloud,
  pushWatchlistUpdates,
  pushPreferenceToCloud,
  pushPlaybackUpsertToCloud,
  pushPlaybackDeleteToCloud,
  pushLiveTvBookmarkDeleteToCloud,
  pushLiveTvBookmarkUpsertToCloud,
  pushHiddenCategoryToCloud,
  pushHiddenCategoryDeleteToCloud,
  batchSyncHiddenCategoriesToCloud,
} from './syncPush';
export type { SyncResult } from './syncTypes';

const log = createLogger('Sync');

/** Erreur notée quand l'effacement de l'ancien fournisseur attend encore (synchro non marquée faite) */
const PROVIDER_PURGE_PENDING = '[Sync] Provider-scoped data skipped: cloud purge of the previous provider pending';

/** Attente maximale des catégories masquées du cloud avant d'afficher l'accueil */
export const HIDDEN_CATEGORIES_BOOT_WAIT_MS = 3000;

// ============================================================================
// SYNC ON LOGIN — Full Merge Bidirectionnel
// ============================================================================

/**
 * Sync complet au login : pull cloud + merge.
 * Prefs + Watchlist sont awaitées (watchlist doit finir avant le re-link pass).
 * Catégories masquées attendues au plus HIDDEN_CATEGORIES_BOOT_WAIT_MS (visibles dès l'accueil).
 * Playback + LiveTv sont fire-and-forget (non critique en timing).
 */
export async function syncOnLogin(userId: string): Promise<SyncResult> {
  const syncStart = performance.now();
  const result: SyncResult = {
    preferences: { pushed: 0, pulled: 0 },
    watchlist: { pushed: 0, pulled: 0 },
    playback: { pushed: 0, pulled: 0 },
    liveTv: { pushed: 0, pulled: 0 },
    hiddenCategories: { pushed: 0, pulled: 0 },
    errors: [],
    cloudWatchlistItems: [],
  };

  // Changement de fournisseur dont l'effacement du cloud n'a pas encore réussi : positions, favoris
  // TV et catégories masquées ne sont pas synchronisés, pour ne pas ramener ceux de l'ancien
  const providerScopesOk = await settlePendingProviderPurge(userId);
  if (!providerScopesOk) result.errors.push(PROVIDER_PURGE_PENDING);

  // 0. Catégories masquées : lancées tout de suite, en parallèle des préférences et de Ma liste
  // (aucune dépendance entre elles), attendues à l'étape 4
  const hiddenSync = !providerScopesOk ? Promise.resolve() : syncHiddenCategories(userId, result).catch((err) => {
    noteSyncError(result, 'HiddenCategories', err);
  });

  // 1. Sync preferences (await — needed before re-link for getLastProviderHash)
  try {
    await syncPreferences(userId, result);
  } catch (err) {
    noteSyncError(result, 'Preferences', err);
  }

  // 2. Sync watchlist (await — must finish before re-link pass)
  try {
    const cloudItems = await syncWatchlist(userId, result);
    result.cloudWatchlistItems = cloudItems.map(ci => ({
      tmdb_id: ci.tmdb_id,
      media_type: ci.media_type,
      provider_hash: ci.provider_hash,
    }));
  } catch (err) {
    noteSyncError(result, 'Watchlist', err);
  }

  // 3. Sync playback + liveTv (fire-and-forget — not timing-critical)
  // NOTE: ces promises sont NON-awaitées, donc result.errors peut ne pas contenir
  // leurs erreurs au moment du return. Acceptable : le caller ne consulte pas errors,
  // et les erreurs sont journalisées.
  const backgroundSyncs: Promise<void>[] = [];
  if (providerScopesOk) {
    backgroundSyncs.push(syncPlayback(userId, result).catch((err) => {
      noteSyncError(result, 'Playback', err);
    }));

    backgroundSyncs.push(syncLiveTv(userId, result).catch((err) => {
      noteSyncError(result, 'LiveTV', err);
    }));
  }

  // 4. Catégories masquées, lancées au début (étape 0) : attente bornée. L'accueil s'affiche
  // dès le retour de syncOnLogin ; une catégorie masquée sur un autre appareil y apparaissait quelques
  // secondes. Un cloud trop lent n'est plus attendu : la synchro continue et l'écran suit à sa fin.
  let bootWaitTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    hiddenSync,
    new Promise<void>((resolve) => { bootWaitTimer = setTimeout(resolve, HIDDEN_CATEGORIES_BOOT_WAIT_MS); }),
  ]);
  clearTimeout(bootWaitTimer);

  // Date de dernière synchro : notée seulement quand TOUT est fini (positions, TV en direct et
  // catégories masquées comprises), sans erreur et dans la base de ce compte.
  // Pas attendue : l'accueil ne dépend pas de cette écriture.
  void Promise.all([...backgroundSyncs, hiddenSync]).then(() => markSynced(userId, result));

  devLog('sync', `syncOnLogin completed in ${(performance.now() - syncStart).toFixed(0)}ms`, result);
  return result;
}

/** Note l'échec d'une étape dans le résultat et le journal (identifiants masqués). */
function noteSyncError(result: SyncResult, label: string, err: unknown, level: 'warn' | 'error' = 'error'): void {
  const detail = sanitizeIptvUrl(`${label} sync failed: ${err}`);
  log[level](detail);
  result.errors.push(`[Sync] ${detail}`);
}

function emptyResult(): SyncResult {
  return {
    preferences: { pushed: 0, pulled: 0 },
    watchlist: { pushed: 0, pulled: 0 },
    playback: { pushed: 0, pulled: 0 },
    liveTv: { pushed: 0, pulled: 0 },
    hiddenCategories: { pushed: 0, pulled: 0 },
    errors: [],
    cloudWatchlistItems: [],
  };
}

async function markSynced(userId: string, result: SyncResult): Promise<void> {
  if (result.errors.length > 0 || !isSameAccount(userId)) return;
  // Tout est passé : un ancien refus pour borne dépassée n'a plus lieu d'être affiché
  clearCloudRefusal();
  try {
    await setMeta('last_synced_at', String(Date.now()));
  } catch (err) {
    log.warn('last_synced_at not saved:', err);
  }
}

// ============================================================================
// SYNC PENDANT LA SESSION — relancée par syncScheduler.ts
// ============================================================================

/**
 * Synchro complète des cinq types, chacun attendu (pas d'écran à débloquer ici). Rattrape les envois
 * ratés depuis la dernière synchro, ajouts comme retraits, et reprend les changements des autres
 * appareils. Pas de re-liaison de Ma liste : les titres copiés du cloud portent le numéro que
 * l'autre appareil y a mis pour le même fournisseur (après un changement de fournisseur, la connexion
 * ou « Rafraîchir » re-lient Ma liste avant de relancer cette synchro).
 */
export async function syncAll(userId: string): Promise<SyncResult> {
  const result = emptyResult();
  const step = async (label: string, task: () => Promise<unknown>) => {
    try {
      await task();
    } catch (err) {
      noteSyncError(result, label, err, 'warn');
    }
  };
  const providerScopesOk = await settlePendingProviderPurge(userId);
  if (!providerScopesOk) result.errors.push(PROVIDER_PURGE_PENDING);
  await step('Preferences', () => syncPreferences(userId, result));
  await step('Watchlist', () => syncWatchlist(userId, result));
  if (providerScopesOk) {
    await step('Playback', () => syncPlayback(userId, result));
    await step('LiveTV', () => syncLiveTv(userId, result));
    await step('HiddenCategories', () => syncHiddenCategories(userId, result));
  }
  await markSynced(userId, result);
  return result;
}
