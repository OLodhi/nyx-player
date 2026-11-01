/**
 * TMDB ID Normalization Utility
 *
 * Convertit n'importe quelle valeur brute en TmdbId canonique.
 *
 * POURQUOI CE FICHIER EXISTE:
 * - Xtream API renvoie `tmdb` dans différents formats selon le provider
 * - Certains renvoient un `number`, d'autres une `string`, d'autres `null`
 * - Certains utilisent `""` ou `"0"` pour indiquer "pas d'ID"
 * - Ce fichier centralise toute la logique de normalisation
 *
 * ANTI-HALLUCINATION:
 * ⚠️ Ne JAMAIS ajouter de nouvelle logique de conversion ailleurs dans le code.
 * ⚠️ Toujours utiliser normalizeTmdbId() à la réception des données Xtream.
 */

import type { TmdbId } from '../types/common';
import { NO_TMDB_ID } from '../types/common';

/**
 * Normalise une valeur brute en TmdbId.
 *
 * @param raw - Valeur brute (peut être number, string, null, undefined, "")
 * @returns TmdbId normalisé (0 si invalide ou absent)
 *
 * @example
 * normalizeTmdbId(123)      // → 123
 * normalizeTmdbId("456")    // → 456
 * normalizeTmdbId("12.5")   // → 12 (tronqué)
 * normalizeTmdbId("")       // → 0
 * normalizeTmdbId(null)     // → 0
 * normalizeTmdbId(undefined)// → 0
 * normalizeTmdbId("abc")    // → 0
 * normalizeTmdbId(0)        // → 0
 * normalizeTmdbId(-5)       // → 0 (IDs négatifs invalides)
 */
export function normalizeTmdbId(raw: unknown): TmdbId {
  // Null, undefined, empty string
  if (raw === null || raw === undefined || raw === '') {
    return NO_TMDB_ID;
  }

  // Already a number
  if (typeof raw === 'number') {
    // NaN, Infinity, negative, or zero → invalid
    if (!Number.isFinite(raw) || raw <= 0) {
      return NO_TMDB_ID;
    }
    // Truncate decimals (shouldn't happen but defensive)
    return Math.floor(raw);
  }

  // String → parse as integer
  if (typeof raw === 'string') {
    // Handle "0", "null", "undefined" strings
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === '0' || trimmed === 'null' || trimmed === 'undefined') {
      return NO_TMDB_ID;
    }

    const parsed = parseInt(raw, 10);

    // Invalid parse result
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NO_TMDB_ID;
    }

    return parsed;
  }

  // Any other type → invalid
  return NO_TMDB_ID;
}

/**
 * Vérifie si un TmdbId est valide (non-zéro).
 *
 * @param id - TmdbId à vérifier
 * @returns true si l'ID est valide
 *
 * @example
 * hasValidTmdbId(123)  // → true
 * hasValidTmdbId(0)    // → false
 */
export function hasValidTmdbId(id: TmdbId): boolean {
  return id !== NO_TMDB_ID;
}


