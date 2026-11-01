/**
 * cloudRefusal.ts — Envoi refusé par la base parce qu'une borne est dépassée
 *
 * La base refuse une valeur trop longue ou un compte qui dépasse son plafond de lignes
 * (supabase/seance/09_bornes_fb01.sql), avec le code PostgreSQL 23514 (`check_violation`). L'appareil
 * garde ses données et réessaie à la synchro suivante, mais l'envoi de ce domaine reste bloqué : le
 * refus est donc signalé dans les Réglages (Compte, hooks/useCloudRefusal.ts), jusqu'à la prochaine
 * synchro complète réussie.
 * L'app reste elle-même sous les bornes (cloudLimits.ts) : ce message ne devrait jamais s'afficher.
 */

const CHECK_VIOLATION = '23514';

let refused = false;
const listeners = new Set<() => void>();

function setRefused(value: boolean): void {
  if (refused === value) return;
  refused = value;
  for (const listener of listeners) listener();
}

/** Vrai si l'erreur rendue par Supabase est un refus pour borne dépassée. */
export function isCloudLimitRefusal(error: { code?: string } | null | undefined): boolean {
  return error?.code === CHECK_VIOLATION;
}

export function noteCloudRefusal(): void {
  setRefused(true);
}

/** Appelé quand une synchro complète a réussi : plus rien n'est bloqué. */
export function clearCloudRefusal(): void {
  setRefused(false);
}

export function hasCloudRefusal(): boolean {
  return refused;
}

/**
 * Erreur d'un envoi groupé, à lever par l'appelant ; un refus pour borne dépassée est noté au passage.
 * Seul le texte de Supabase est gardé dans le message, comme avant.
 */
export function cloudWriteError(what: string, error: { message: string; code?: string }): Error {
  if (isCloudLimitRefusal(error)) noteCloudRefusal();
  return new Error(`${what}: ${error.message}`);
}

/** Prévient `listener` à chaque changement ; rend la fonction qui arrête l'écoute. */
export function subscribeCloudRefusal(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
