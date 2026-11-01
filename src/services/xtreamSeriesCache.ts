/**
 * xtreamSeriesCache.ts — Cache des épisodes de séries Xtream
 *
 * Responsabilités :
 * - Stocker/récupérer les infos de séries Xtream (épisodes) depuis SQLite
 * - TTL de 24h (les épisodes peuvent être ajoutés)
 *
 * Séparé de tmdbCacheSqlite car le cache Xtream n'a pas de rapport
 * avec le pipeline TMDB — c'est du cache de données provider.
 */

import { getDatabase } from './dbCore';
import { nowSeconds, isCacheValid } from '../utils/timeHelpers';
import { createLogger } from '../utils/logger';

const log = createLogger('XtreamSeriesCache');

// ============================================================================
// CONSTANTS
// ============================================================================

/** 24 hours for Xtream series info (episodes may be added) */
const TTL_SERIES_INFO = 24 * 60 * 60; // 86400

// ============================================================================
// TYPES
// ============================================================================

/** Row in xtream_series_cache table */
interface XtreamSeriesCacheRow {
  series_id: number;
  data: string;
  cached_at: number;
  ttl_seconds: number;
}

// Utility functions (nowSeconds, isCacheValid) imported from utils/timeHelpers.ts

// ============================================================================
// CACHE OPERATIONS
// ============================================================================

/**
 * Get cached Xtream series info (episodes)
 */
export async function getCachedXtreamSeries<T>(seriesId: number): Promise<T | null> {
  const db = await getDatabase();
  
  const results = await db.select<XtreamSeriesCacheRow[]>(
    `SELECT data, cached_at, ttl_seconds FROM xtream_series_cache WHERE series_id = ?`,
    [seriesId]
  );
  
  if (results.length === 0) return null;
  
  const row = results[0];
  
  if (!isCacheValid(row.cached_at, row.ttl_seconds)) {
    return null;
  }
  
  try {
    return JSON.parse(row.data) as T;
  } catch {
    log.error(`Failed to parse cache for series ${seriesId}`);
    return null;
  }
}

/**
 * Cache Xtream series info (episodes)
 */
export async function setCachedXtreamSeries<T>(seriesId: number, data: T): Promise<void> {
  try {
    const db = await getDatabase();
    
    await db.execute(
      `INSERT OR REPLACE INTO xtream_series_cache (series_id, data, cached_at, ttl_seconds)
       VALUES (?, ?, ?, ?)`,
      [seriesId, JSON.stringify(data), nowSeconds(), TTL_SERIES_INFO]
    );
  } catch (error) {
    log.error(`Failed to cache series ${seriesId}:`, error);
  }
}
