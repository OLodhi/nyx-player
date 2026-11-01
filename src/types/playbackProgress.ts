/**
 * PlaybackProgressRow — Row SQLite pour la table playback_progress
 *
 * Type partagé entre playbackProgressService (CRUD) et smartContinue (carrousel).
 * Extrait ici pour éliminer la duplication.
 */

export interface PlaybackProgressRow {
  id: number;
  content_type: 'movie' | 'episode';
  stream_id: number;
  tmdb_id: number | null;
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
