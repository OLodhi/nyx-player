/**
 * TMDB Logo Selection Helper
 *
 * Sélectionne le meilleur logo officiel depuis les images TMDB.
 * Priorité : langue utilisateur → anglais → sans texte (null) → premier disponible.
 *
 * @module utils/tmdbLogoHelper
 */

import type { TmdbImages } from '../types/tmdb';
import tmdb from '../services/tmdbApi';

/**
 * Sélectionne le meilleur logo depuis les données images TMDB.
 *
 * Stratégie de sélection (dans l'ordre) :
 * 1. Logos dans la langue courante (fr ou en), triés par vote_average desc
 * 2. Logos en anglais (fallback)
 * 3. Logos sans langue (iso_639_1 === null) — logos universels
 * 4. Premier logo disponible (toutes langues)
 *
 * Filtres : largeur minimum 200px pour éviter les icônes pixelisées.
 *
 * @param images - Objet TmdbImages retourné par getMovieDetails/getTvDetails
 * @param userLang - Code langue ISO 639-1 ('fr' ou 'en')
 * @returns URL complète du logo ou null si aucun logo disponible
 */
export function pickBestLogo(
  images: TmdbImages | undefined,
  userLang: 'fr' | 'en' = 'fr',
): string | null {
  if (!images?.logos || images.logos.length === 0) return null;

  const MIN_WIDTH = 200;
  const candidates = images.logos.filter(l => l.width >= MIN_WIDTH);
  if (candidates.length === 0) return null;

  // Helper: trier par vote_average desc, puis par largeur desc
  const sortByQuality = (a: typeof candidates[0], b: typeof candidates[0]) =>
    b.vote_average - a.vote_average || b.width - a.width;

  // 1. Langue utilisateur
  const userLangLogos = candidates.filter(l => l.iso_639_1 === userLang).sort(sortByQuality);
  if (userLangLogos.length > 0) {
    return tmdb.imageUrl(userLangLogos[0].file_path, 'w500');
  }

  // 2. Fallback anglais (si pas déjà la langue user)
  if (userLang !== 'en') {
    const enLogos = candidates.filter(l => l.iso_639_1 === 'en').sort(sortByQuality);
    if (enLogos.length > 0) {
      return tmdb.imageUrl(enLogos[0].file_path, 'w500');
    }
  }

  // 3. Logos sans langue (universels)
  const nullLangLogos = candidates.filter(l => l.iso_639_1 === null).sort(sortByQuality);
  if (nullLangLogos.length > 0) {
    return tmdb.imageUrl(nullLangLogos[0].file_path, 'w500');
  }

  // 4. Dernier recours : premier logo disponible
  candidates.sort(sortByQuality);
  return tmdb.imageUrl(candidates[0].file_path, 'w500');
}
