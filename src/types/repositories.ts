/**
 * Repository Row Types
 *
 * Types partagés pour les lignes SQLite des repositories.
 * Extraits depuis les services/*Repository.ts pour respecter le flux
 * types → utils → services (pas d'import remontant).
 */

// ============================================================================
// MOVIE
// ============================================================================

export interface MovieRow {
  id: number;
  tmdb_id: number | null;
  name: string;
  icon: string | null;
  category_id: string | null;
  added: number | null;
  rating: number | null;
  container_extension: string | null;
  data: string | null;
  sort_order: number;
}

// ============================================================================
// SERIES
// ============================================================================

export interface SeriesRow {
  id: number;
  tmdb_id: number | null;
  name: string;
  icon: string | null;
  category_id: string | null;
  added: number | null;
  rating: number | null;
  data: string | null;
  sort_order: number;
}

// ============================================================================
// LIVE
// ============================================================================

export interface LiveRow {
  id: number;
  name: string;
  icon: string | null;
  category_id: string | null;
  epg_channel_id: string | null;
  matched_epg_id: string | null;
  match_method: string | null;
  data: string | null;
  sort_order: number;
}

// ============================================================================
// CATEGORY
// ============================================================================

export interface CategoryRow {
  id: string;
  name: string;
  type: 'movie' | 'series' | 'live';
  sort_order: number;
}
