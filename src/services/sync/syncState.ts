/**
 * syncState.ts — État utilisateur module-level pour le sync
 *
 * Stocke le userId connecté pour que les services puissent push sans context React.
 */

import { clearCloudRefusal } from './cloudRefusal';

let currentUserId: string | null = null;

/** Enregistre le userId connecté (appelé par SupabaseAuthContext au login) */
export function setCurrentSyncUserId(userId: string | null): void {
  // Autre compte ou déconnexion : un refus noté pour l'ancien compte ne le suit pas
  if (userId !== currentUserId) clearCloudRefusal();
  currentUserId = userId;
}

/** Retourne le userId actuel ou null */
export function getCurrentSyncUserId(): string | null {
  return currentUserId;
}

/**
 * Guard sync : vérifie qu'un push cloud est possible.
 * Retourne true si un user est connecté (et sync activée en V2).
 * Utilisé par tous les fire-and-forget (upsert et delete).
 */
export function canSync(): boolean {
  return currentUserId !== null;
  // V2 : && isSyncEnabled()
}
