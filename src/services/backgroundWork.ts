/**
 * backgroundWork.ts — Arrêt des travaux de fond sur le catalogue, sans dépendance lourde.
 *
 * Module léger (comme catalogCaches.ts) pour que la déconnexion Supabase et la remise à zéro
 * puissent arrêter l'actualisation automatique (catalogAutoRefresh.ts, qui s'inscrit ici) sans
 * importer toute sa chaîne de modules.
 */

let stopper: (() => Promise<void>) | null = null;

export function registerBackgroundStop(fn: (() => Promise<void>) | null): void {
  stopper = fn;
}

/**
 * Arrête l'actualisation en arrière-plan et vide le catalogue en attente. La promesse se résout
 * quand le passage en cours a rendu la main ; ne jamais l'attendre là où Supabase tient son verrou
 * de session (événement SIGNED_OUT).
 */
export function stopBackgroundWork(): Promise<void> {
  return stopper ? stopper().catch(() => {}) : Promise.resolve();
}
