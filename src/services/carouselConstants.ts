/**
 * Carousel Constants
 * Constantes et définitions des carousels du Dashboard et des genres TMDB.
 * Séparé de preferencesService.ts pour éviter les imports circulaires.
 */

import { isEnglish } from '../utils/tmdbLanguage';

// ============================================================================
// TYPES
// ============================================================================

interface CarouselConfig {
  id: string;
  label_fr: string;
  label_en: string;
  removable: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Carousels par défaut du Dashboard - avec traductions FR/EN */
export const DEFAULT_CAROUSELS: CarouselConfig[] = [
  { id: 'popular', label_fr: 'Films Populaires', label_en: 'Popular Movies', removable: true },
  { id: 'continue', label_fr: 'Reprendre la lecture', label_en: 'Continue Watching', removable: true },
  { id: 'nowPlaying', label_fr: 'Films Récents', label_en: 'Recent Movies', removable: true },
  { id: 'onTheAir', label_fr: 'Séries Récentes', label_en: 'Recent Series', removable: true },
  { id: 'watchlist', label_fr: 'Ma Liste', label_en: 'My List', removable: true },
  { id: 'topRated', label_fr: 'Top Films', label_en: 'Top Rated', removable: true },
  { id: 'trending', label_fr: 'Tendances Actuelles', label_en: 'Trending Now', removable: true },
  { id: 'thisWeekMovies', label_fr: 'Nouveautés Films', label_en: 'New Movies This Week', removable: true },
  { id: 'thisWeekSeries', label_fr: 'Nouveautés Séries', label_en: 'New Series This Week', removable: true },
];

/**
 * Retourne le label d'un carousel système dans la langue courante
 */
export function getCarouselLabel(carouselId: string): string {
  const carousel = DEFAULT_CAROUSELS.find((c) => c.id === carouselId);
  if (!carousel) return carouselId;
  return isEnglish() ? carousel.label_en : carousel.label_fr;
}

/** Genres TMDB disponibles (films) - avec traductions FR/EN */
export const TMDB_GENRES: { id: number; name_fr: string; name_en: string }[] = [
  { id: 28, name_fr: 'Action', name_en: 'Action' },
  { id: 12, name_fr: 'Aventure', name_en: 'Adventure' },
  { id: 16, name_fr: 'Animation', name_en: 'Animation' },
  { id: 35, name_fr: 'Comédie', name_en: 'Comedy' },
  { id: 80, name_fr: 'Crime', name_en: 'Crime' },
  { id: 99, name_fr: 'Documentaire', name_en: 'Documentary' },
  { id: 18, name_fr: 'Drame', name_en: 'Drama' },
  { id: 10751, name_fr: 'Famille', name_en: 'Family' },
  { id: 14, name_fr: 'Fantastique', name_en: 'Fantasy' },
  { id: 36, name_fr: 'Histoire', name_en: 'History' },
  { id: 27, name_fr: 'Horreur', name_en: 'Horror' },
  { id: 10402, name_fr: 'Musique', name_en: 'Music' },
  { id: 9648, name_fr: 'Mystère', name_en: 'Mystery' },
  { id: 10749, name_fr: 'Romance', name_en: 'Romance' },
  { id: 878, name_fr: 'Science-Fiction', name_en: 'Science Fiction' },
  { id: 53, name_fr: 'Thriller', name_en: 'Thriller' },
  { id: 10752, name_fr: 'Guerre', name_en: 'War' },
  { id: 37, name_fr: 'Western', name_en: 'Western' },
];

/**
 * Retourne le nom d'un genre par son ID (dans la langue courante)
 */
export function getGenreName(genreId: number): string {
  const genre = TMDB_GENRES.find((g) => g.id === genreId);
  if (!genre) return `Genre ${genreId}`;
  return isEnglish() ? genre.name_en : genre.name_fr;
}
