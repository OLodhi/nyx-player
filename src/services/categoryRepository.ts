/**
 * Category Repository — CRUD operations for categories table
 */

import { getDatabase } from './dbCore';

// ============================================================================
// TYPES
// ============================================================================

// Re-export for backward compatibility
export type { CategoryRow } from '../types/repositories';
import type { CategoryRow } from '../types/repositories';


// ============================================================================
// CRUD
// ============================================================================

export async function getAllCategories(): Promise<CategoryRow[]> {
  const database = await getDatabase();
  return database.select<CategoryRow[]>('SELECT * FROM categories ORDER BY sort_order ASC');
}

