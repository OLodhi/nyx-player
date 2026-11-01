/**
 * Dashboard Types
 *
 * Types partagés pour les composants et hooks du dashboard.
 * Extrait depuis HeroBanner.tsx pour respecter le flux types → utils → hooks → components.
 */

export interface HeroMovie<T = unknown> {
  id: string | number;
  tmdbId?: number;  // TMDB ID for watchlist deduplication
  title: string;
  overview: string;
  backdropUrl: string;
  logoUrl?: string;
  rating?: number;
  year?: string;
  duration?: string;
  inWatchlist?: boolean; // Optional: can be overridden by async check
  data?: T;
}
