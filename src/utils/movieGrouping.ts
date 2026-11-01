/**
 * Movie Grouping - Simple Approach
 *
 * 1. Normalize titles (remove IPTV prefixes + special chars)
 * 2. Block by first 5 chars
 * 3. Fuzzy match within blocks (Dice coefficient)
 * 4. Background verification via tmdb_id (optional)
 */

import { normalizeTmdbId, hasValidTmdbId } from './normalizeTmdb';

export interface GroupedItem<T> {
  representative: T;
  items: T[];
  sourceCount: number;
  groupKey: string;
}

// ============ TMDB GROUPING (Instant, O(n)) ============

/**
 * Groupe les items par TMDB ID (instant, O(n)).
 * 
 * COMPORTEMENT CRITIQUE:
 * - Seuls les items avec un TMDB ID valide (> 0) sont inclus
 * - Les items sans TMDB ID sont EXCLUS (pas d'orphelins)
 * - Utilise normalizeTmdbId() pour gérer les cas string "0", null, undefined
 * 
 * @template T - Type d'item avec propriété tmdb optionnelle
 * @param items - Liste d'items à grouper
 * @returns Liste de groupes avec representative, items[], sourceCount
 * 
 * @example
 * // Items avec même TMDB ID → groupés ensemble
 * groupByTmdbId([
 *   { name: "Film (4K)", tmdb: 12345 },
 *   { name: "Film (HD)", tmdb: 12345 },
 *   { name: "Film (SD)", tmdb: 12345 },
 * ])
 * // → [{ representative: first, items: all3, sourceCount: 3 }]
 * 
 * @example
 * // Items sans TMDB → EXCLUS
 * groupByTmdbId([
 *   { name: "Film sans TMDB", tmdb: 0 },
 *   { name: "Autre", tmdb: undefined },
 * ])
 * // → [] (vide!)
 * 
 * ANTI-HALLUCINATION:
 * ⚠️ Cette fonction EXCLUT les orphelins par design (qualité Nyx Player)
 * ⚠️ Pour inclure les orphelins, créer une fonction séparée
 */
export function groupByTmdbId<T extends { tmdb?: number | string; tmdbId?: number; stream_id?: number | string; id?: number }>(
  items: T[]
): GroupedItem<T>[] {
  const tmdbGroups = new Map<number, T[]>();
  // orphans removed: we intentionally hide items without TMDB ID

  for (const item of items) {
    // Support both tmdb (IptvStream) and tmdbId (LightMovie/LightSeries)
    const rawTmdb = 'tmdbId' in item ? item.tmdbId : item.tmdb;
    const tmdbId = normalizeTmdbId(rawTmdb);

    if (hasValidTmdbId(tmdbId)) {
      if (!tmdbGroups.has(tmdbId)) tmdbGroups.set(tmdbId, []);
      tmdbGroups.get(tmdbId)!.push(item);
    }
  }

  const result: GroupedItem<T>[] = [];

  // TMDB groups
  for (const [tmdbId, group] of tmdbGroups) {
    result.push({
      representative: group[0],
      items: group,
      sourceCount: group.length,
      groupKey: `tmdb_${tmdbId}`,
    });
  }

  // Orphans are intentionally excluded per "Nyx Player" quality standards

  return result;
}


