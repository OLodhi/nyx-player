/**
 * itemHelpers.ts - Utilitaires pour le traitement des items IPTV
 *
 * @module itemHelpers
 */

/**
 * Nettoyer un titre Xtream pour le rendre comparable aux titres TMDB.
 *
 * Supprime :
 * - Préfixes de langue (FR, EN, VO, VF, VOST, MULTI)
 * - Suffixes de qualité (4K, UHD, 1080p, 720p, HD, HEVC, H265, HDR)
 * - Année en fin de titre
 *
 * @param title - Le titre brut
 * @returns Le titre nettoyé
 */
export function cleanTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^(?:FR|EN|VO|VF|VOST|MULTI)\s*[-:]+\s*/i, '')
    .replace(/\s*(?:4K|UHD|1080p|720p|HD|HEVC|H265|HDR).*/i, '')
    .replace(/\s*\(?\d{4}\)?\s*$/, '')
    .trim();
}
