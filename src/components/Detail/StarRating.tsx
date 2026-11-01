/**
 * StarRating — Composant pur pour afficher un score sous forme d'étoiles.
 *
 * Convertit un score TMDB (0-10) en étoiles (0-5).
 * Utilisé par MovieDetailPage et SeriesDetailPage.
 */

/**
 * Convertit un score TMDB (0-10) en chaîne de 5 étoiles ★/☆.
 * @param score - Score TMDB (0-10)
 * @returns Chaîne de 5 caractères, ex: "★★★☆☆"
 */
export function renderStars(score: number): string {
    const stars = Math.round(score / 2);
    return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}
