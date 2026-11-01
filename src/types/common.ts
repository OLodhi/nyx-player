/**
 * Common Types for Nyx Player
 *
 * Types partagés à travers l'application.
 * Ce fichier contient les types fondamentaux qui doivent être cohérents partout.
 */

// ============================================================================
// TMDB ID TYPE
// ============================================================================

/**
 * Type canonique pour les IDs TMDB.
 *
 * RÈGLES:
 * - Toujours un `number`
 * - `0` signifie "pas d'ID TMDB" (valeur sentinelle)
 * - Ne jamais comparer avec `null` ou `undefined` — utiliser `=== 0`
 *
 * CONTEXTE:
 * Xtream API renvoie `tmdb` parfois comme `number`, parfois comme `string`,
 * parfois comme `""` ou `null`. Ce type garantit une valeur normalisée.
 *
 * USAGE:
 * ```typescript
 * import { TmdbId, normalizeTmdbId } from '../types/common';
 *
 * const id: TmdbId = normalizeTmdbId(item.tmdb);
 * if (id !== 0) {
 *   // ID valide, faire quelque chose
 * }
 * ```
 *
 * @see normalizeTmdbId dans utils/normalizeTmdb.ts
 */
export type TmdbId = number;

/**
 * Valeur sentinelle pour "pas d'ID TMDB".
 * Utiliser cette constante plutôt que le littéral `0` pour la clarté.
 */
export const NO_TMDB_ID: TmdbId = 0;

// ============================================================================
// RESET OPTIONS
// ============================================================================

/** Options pour les modales de reset partiel (films / séries) */
export interface ResetOptions {
  positions: boolean;
  cache: boolean;
}

