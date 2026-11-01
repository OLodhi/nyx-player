/**
 * syncPush.ts — Fire-and-forget push functions vers Supabase
 *
 * Fonctions qui poussent des modifications individuelles vers le cloud.
 * Chaque push est fire-and-forget. Un envoi réussi met à jour le dernier accord avec le cloud
 * (syncBaseline.ts) ; un envoi raté (hors ligne, jeton expiré) ne le touche pas, et la synchro
 * suivante le rattrape, ajout comme retrait (synchro relancée par syncScheduler.ts).
 *
 * Le code est rangé par sujet dans push/ ; ce fichier les réunit pour que les appels
 * existants (syncService.ts, tests) ne changent pas.
 */

export { pushWatchlistDeleteToCloud, pushWatchlistUpsertToCloud, pushWatchlistUpdates } from './push/watchlistPush';
export { placeWatchlistTitles } from './push/watchlistPlacement';
export type { WatchlistPlacement } from './push/watchlistPlacement';
export { pushPreferenceToCloud } from './push/preferencesPush';
export { pushPlaybackUpsertToCloud, pushPlaybackDeleteToCloud } from './push/playbackPush';
export { pushLiveTvBookmarkDeleteToCloud, pushLiveTvBookmarkUpsertToCloud } from './push/liveTvPush';
export { pushHiddenCategoryToCloud, pushHiddenCategoryDeleteToCloud } from './push/hiddenCategoriesPush';
export { batchSyncHiddenCategoriesToCloud } from './push/hiddenCategoriesBatch';
