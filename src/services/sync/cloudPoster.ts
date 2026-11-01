/**
 * cloudPoster.ts — Affiche d'une reprise envoyée au cloud (moins de données envoyées)
 */

import { fitsCloudPosterUrl } from './cloudLimits';

/** Seules les affiches TMDB partent au cloud */
const TMDB_IMAGE_PREFIX = 'https://image.tmdb.org/';
/** Affiche TMDB donnée en http par certains fournisseurs (`cover` Xtream) */
const TMDB_IMAGE_HTTP_PREFIX = 'http://image.tmdb.org/';

/**
 * Affiche à envoyer au cloud pour une reprise : l'adresse d'une image TMDB (passée en https si
 * le fournisseur la donne en http), sinon rien.
 * Une affiche du fournisseur porte le nom de son serveur, parfois ses identifiants :
 * elle reste sur l'appareil. Un autre appareil garde la sienne pour le même titre (une affiche
 * absente ne la remplace pas, voir syncPlayback) ; sinon il affiche celle de la fiche TMDB
 * quand il la connaît.
 */
export function cloudPosterUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Une adresse plus longue que la borne de la base ferait refuser tout l'envoi groupé
  const fits = (value: string) => (fitsCloudPosterUrl(value) ? value : null);
  if (url.startsWith(TMDB_IMAGE_PREFIX)) return fits(url);
  if (url.startsWith(TMDB_IMAGE_HTTP_PREFIX)) return fits(`https://${url.slice('http://'.length)}`);
  return null;
}
