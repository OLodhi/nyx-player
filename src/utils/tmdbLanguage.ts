/**
 * TMDB Language Helper
 * 
 * Centralized utility for getting the current TMDB API language
 * based on the application's i18n configuration.
 */

import i18n from '../i18n/config';

/**
 * Langue réellement affichée par l'app ('fr' ou 'en').
 * `i18n.language` garde la locale brute du système (ex. 'en-US', 'de-DE') ;
 * `resolvedLanguage` est la langue traduite retenue par i18next.
 */
export const getAppLanguage = (): 'fr' | 'en' => {
  const lng = (i18n.resolvedLanguage || i18n.language || '').toLowerCase();
  return lng.startsWith('fr') ? 'fr' : 'en';
};

/**
 * Get the TMDB API language code based on current i18n setting.
 * TMDB uses ISO 639-1 with region (e.g., 'fr-FR', 'en-US').
 */
export const getTmdbLanguage = (): 'fr-FR' | 'en-US' => {
  return getAppLanguage() === 'en' ? 'en-US' : 'fr-FR';
};

/**
 * Check if current language is English
 */
export const isEnglish = (): boolean => {
  return getAppLanguage() === 'en';
};
