/**
 * TMDB API Types for Nyx Player
 */

// Base response structure
export interface TmdbSearchResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

// Movie search result (from /search/movie)
export interface TmdbMovieSearchResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  genre_ids: number[];
  popularity: number;
  // Present in /trending responses to distinguish movie vs tv
  media_type?: 'movie' | 'tv' | 'person';
  // TV-specific fields (present when media_type is 'tv')
  name?: string;
  first_air_date?: string;
}

// TV search result (from /search/tv)
export interface TmdbTvSearchResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
  // Present in /trending responses
  media_type?: 'movie' | 'tv' | 'person';
}

/**
 * Result from /trending endpoint - can be movie or TV
 * Use media_type to distinguish
 */
export type TmdbTrendingResult = TmdbMovieSearchResult | TmdbTvSearchResult;

// Genre
export interface TmdbGenre {
  id: number;
  name: string;
}

// Cast member
interface TmdbCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

// Crew member
interface TmdbCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path: string | null;
}

// Credits
export interface TmdbCredits {
  cast: TmdbCastMember[];
  crew: TmdbCrewMember[];
}

// Video (trailers)
interface TmdbVideo {
  id: string;
  key: string; // YouTube video ID
  name: string;
  site: string; // "YouTube"
  type: string; // "Trailer", "Teaser", etc.
  official: boolean;
}

export interface TmdbVideos {
  results: TmdbVideo[];
}

// Image (backdrop, poster, logo)
interface TmdbImage {
  file_path: string;
  aspect_ratio: number;
  height: number;
  width: number;
  vote_average: number;
  vote_count: number;
  iso_639_1: string | null; // null = no text/language overlay
}

// Images collection
export interface TmdbImages {
  backdrops: TmdbImage[];
  posters: TmdbImage[];
  logos: TmdbImage[];
}

// Movie details (from /movie/{id})
export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  runtime: number | null;
  vote_average: number;
  vote_count: number;
  adult: boolean;
  genres: TmdbGenre[];
  tagline: string;
  status: string;
  imdb_id: string | null;
  // Appended data (via append_to_response)
  credits?: TmdbCredits;
  videos?: TmdbVideos;
  recommendations?: TmdbSearchResponse<TmdbMovieSearchResult>;
  images?: TmdbImages; // Multiple backdrops for variety
}

// TV Season
export interface TmdbSeason {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
  episode_count: number;
  air_date: string;
}

// TV details (from /tv/{id})
export interface TmdbTvDetails {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  last_air_date: string;
  vote_average: number;
  vote_count: number;
  genres: TmdbGenre[];
  status: string; // "Returning Series", "Ended", etc.
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  seasons: TmdbSeason[];
  // Appended data
  credits?: TmdbCredits;
  videos?: TmdbVideos;
  images?: TmdbImages; // Multiple backdrops for variety
}

// Episode details
export interface TmdbEpisode {
  id: number;
  name: string;
  overview: string;
  still_path: string | null;
  air_date: string;
  episode_number: number;
  season_number: number;
  runtime: number | null;
  vote_average: number;
}

// Season details (from /tv/{id}/season/{season_number})
export interface TmdbSeasonDetails {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  season_number: number;
  episodes: TmdbEpisode[];
}
