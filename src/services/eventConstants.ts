/**
 * Event Constants — Noms d'événements CustomEvent centralisés.
 *
 * Élimine les string literals dispersés dans ~23 fichiers.
 * Une typo compile-time au lieu d'un bug silencieux runtime.
 */

export const WATCHLIST_EVENT = 'watchlistUpdated';
export const PLAYBACK_EVENT = 'playbackPositionUpdated';
export const PREFERENCES_EVENT = 'preferencesUpdated';
export const LIVE_TV_BOOKMARKS_EVENT = 'liveTvBookmarksUpdated';
export const HIDDEN_CATEGORIES_EVENT = 'hiddenCategoriesUpdated';
export const TMDB_LANGUAGE_EVENT = 'tmdb-language-changed';
export const CAROUSEL_PREFERENCES_EVENT = 'carousel_preferences';
export const DASHBOARD_RESET_EVENT = 'dashboard-reset-to-default';
export const EPG_UPDATED_EVENT = 'epgUpdated';
