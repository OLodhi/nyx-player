/**
 * syncTypes.ts — Types partagés pour le module sync
 *
 * Toutes les interfaces Cloud et Local utilisées par les modules de sync.
 */

// ============================================================================
// SYNC RESULT
// ============================================================================

export interface SyncResult {
  preferences: { pushed: number; pulled: number };
  watchlist: { pushed: number; pulled: number };
  playback: { pushed: number; pulled: number };
  liveTv: { pushed: number; pulled: number };
  hiddenCategories: { pushed: number; pulled: number };
  errors: string[];
  /** Cloud watchlist items with provider_hash — passed to re-link pass to avoid double-fetch */
  cloudWatchlistItems: { tmdb_id: number; media_type: 'movie' | 'series'; provider_hash: string | null }[];
}

// ============================================================================
// CLOUD ROW TYPES
// ============================================================================

/** Row cloud user_preferences */
export interface CloudPref {
  user_id: string;
  key: string;
  value: string;
  updated_at: string; // ISO timestamptz
}

/** Row cloud user_watchlist */
export interface CloudWatchlistItem {
  user_id: string;
  tmdb_id: number;
  media_type: 'movie' | 'series';
  stream_id: number;
  provider_hash: string | null;
  added_at: string;
  updated_at: string;
}

/** Row cloud user_livetv_bookmarks */
export interface CloudLiveTvBookmark {
  user_id: string;
  bookmark_type: 'favorite' | 'pinned_category';
  item_id: string;
  added_at: string;
  /** Empreinte du fournisseur qui a envoyé la ligne, absente des lignes plus anciennes */
  provider_hash?: string | null;
}

/** Row cloud user_playback_progress */
export interface CloudPlaybackRow {
  user_id: string;
  stream_id: number;
  content_type: 'movie' | 'episode';
  tmdb_id: number;
  title: string;
  poster_url: string | null;
  series_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  next_episode_id: string | null;
  next_season: number | null;
  next_episode_number: number | null;
  time_seconds: number;
  duration_seconds: number;
  container_extension: string | null;
  updated_at: string;
  /** Empreinte du fournisseur qui a envoyé la ligne, absente des lignes plus anciennes */
  provider_hash?: string | null;
}

/** Row cloud user_hidden_categories */
export interface CloudHiddenCategory {
  user_id: string;
  category_id: string;
  category_type: string;
  /** Empreinte du fournisseur qui a envoyé la ligne, absente des lignes plus anciennes */
  provider_hash?: string | null;
}

// ============================================================================
// LOCAL ROW TYPES
// ============================================================================

/** Row local SQLite watchlist */
export interface LocalWatchlistRow {
  stream_id: number;
  tmdb_id: number;
  type: 'movie' | 'series';
  added_at: number;
  updated_at: number;
}

/** Row local SQLite playback_progress */
export interface LocalPlaybackRow {
  stream_id: number;
  content_type: 'movie' | 'episode';
  tmdb_id: number;
  title: string;
  poster_url: string | null;
  series_id: number | null;
  season_number: number | null;
  episode_number: number | null;
  next_episode_id: string | null;
  next_season: number | null;
  next_episode_number: number | null;
  time_seconds: number;
  duration_seconds: number;
  container_extension: string | null;
  updated_at: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Convertit ISO timestamptz → ms epoch */
export function isoToMs(iso: string): number {
  return new Date(iso).getTime();
}
