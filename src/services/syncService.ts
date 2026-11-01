/**
 * syncService.ts — Barrel de rétrocompatibilité
 *
 * Ce fichier ré-exporte tout depuis services/sync/ pour que les imports existants
 * (ex: import { pushPreferenceToCloud } from './syncService') continuent de fonctionner.
 *
 * Le code réel est dans services/sync/*.ts.
 */

export {
  // Orchestrateur
  syncOnLogin,
  // State
  setCurrentSyncUserId,
  canSync,
  getCurrentSyncUserId,
  // Purge
  purgeCloudData,
  fetchCloudProviderHash,
  purgeProviderCloudData,
  // Push fire-and-forget
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
} from './sync/syncService';

export type { SyncResult } from './sync/syncTypes';
