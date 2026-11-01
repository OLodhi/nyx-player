/**
 * Series Repository — CRUD operations for series table
 */

import { getDatabase } from './dbCore';
import type { IptvSeries } from '../types/iptv';

// ============================================================================
// TYPES
// ============================================================================

// Re-export for backward compatibility
export type { SeriesRow } from '../types/repositories';
import type { SeriesRow } from '../types/repositories';


// ============================================================================
// MAPPER
// ============================================================================

/**
 * Convert a SeriesRow from SQLite into an IptvSeries object.
 * Single source of truth for this mapping — used by detailFetcher.
 */
export function toIptvSeries(entry: SeriesRow): IptvSeries {
  return {
    num: 0,
    name: entry.name,
    series_id: entry.id,
    cover: entry.icon || '',
    plot: '',
    cast: '',
    director: '',
    genre: '',
    releaseDate: '',
    last_modified: entry.added ? String(entry.added) : '',
    rating: entry.rating ? String(entry.rating) : '',
    category_id: entry.category_id || '',
    tmdb: entry.tmdb_id || 0,
  };
}

/**
 * Get all series (for building LightIndex)
 * Only fetches columns needed for LightIndex - not rating/data
 */
export async function getAllSeries(): Promise<SeriesRow[]> {
  const database = await getDatabase();
  const result = await database.select<SeriesRow[]>(
    'SELECT id, tmdb_id, name, icon, category_id, added FROM series ORDER BY sort_order ASC'
  );
  return result;
}

/**
 * Get a single series by ID
 */
export async function getSeriesById(id: number): Promise<SeriesRow | null> {
  const database = await getDatabase();
  const result = await database.select<SeriesRow[]>(
    'SELECT * FROM series WHERE id = ?',
    [id]
  );
  return result.length > 0 ? result[0] : null;
}

