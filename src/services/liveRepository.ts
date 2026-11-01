/**
 * Live Repository — CRUD operations for live streams table
 */

import { getDatabase } from './dbCore';

// ============================================================================
// TYPES
// ============================================================================

// Re-export for backward compatibility
export type { LiveRow } from '../types/repositories';
import type { LiveRow } from '../types/repositories';


// ============================================================================
// CRUD
// ============================================================================

/**
 * Get all live streams (for building LightIndex)
 * Only fetches columns needed for LightIndex - not data
 */
export async function getAllLive(): Promise<LiveRow[]> {
  const database = await getDatabase();
  const result = await database.select<LiveRow[]>(
    'SELECT id, name, icon, category_id, epg_channel_id, matched_epg_id, match_method FROM live ORDER BY sort_order ASC'
  );
  return result;
}

