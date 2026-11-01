/**
 * Movie Repository — CRUD operations for movies table
 */

import { getDatabase } from './dbCore';
import type { IptvStream } from '../types/iptv';

// ============================================================================
// TYPES
// ============================================================================

// Re-export for backward compatibility
export type { MovieRow } from '../types/repositories';
import type { MovieRow } from '../types/repositories';


// ============================================================================
// MAPPER
// ============================================================================

/**
 * Convert a MovieRow from SQLite into an IptvStream object.
 * Single source of truth for this mapping — used by detailFetcher.
 */
export function toIptvStream(entry: MovieRow): IptvStream {
  return {
    num: 0,
    name: entry.name,
    stream_type: 'movie',
    stream_id: entry.id,
    stream_icon: entry.icon || '',
    added: entry.added ? String(entry.added) : '',
    category_id: entry.category_id || '',
    rating: entry.rating ? String(entry.rating) : undefined,
    tmdb: entry.tmdb_id || 0,
    container_extension: entry.container_extension || undefined,
  };
}

/**
 * Get all movies (for building LightIndex)
 * Only fetches columns needed for LightIndex - not rating/data
 */
export async function getAllMovies(): Promise<MovieRow[]> {
  const database = await getDatabase();
  const result = await database.select<MovieRow[]>(
    'SELECT id, tmdb_id, name, icon, category_id, added, container_extension FROM movies ORDER BY sort_order ASC'
  );
  return result;
}

/**
 * Get a single movie by ID
 */
export async function getMovieById(id: number): Promise<MovieRow | null> {
  const database = await getDatabase();
  const result = await database.select<MovieRow[]>(
    'SELECT * FROM movies WHERE id = ?',
    [id]
  );
  return result.length > 0 ? result[0] : null;
}

