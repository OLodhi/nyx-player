/**
 * cloudLimits.ts — Tailles maximales des valeurs envoyées au cloud.
 * La base refuse désormais une valeur trop longue (supabase/seance/09_bornes_fb01.sql) ; un seul
 * refus ferait échouer tout l'envoi groupé des reprises, à chaque synchro. L'app reste donc sous
 * les bornes de la base : même valeur ici et dans le script SQL.
 */

/**
 * Titre d'une reprise, en caractères (base : 2 000 octets, soit 500 caractères même de 4 octets ;
 * plus long titre réel relevé : 82)
 */
export const CLOUD_TITLE_MAX_LENGTH = 500;
/** Extension du fichier d'une reprise, en octets (base : 16 ; réel : mkv, mp4…) */
export const CLOUD_CONTAINER_EXTENSION_MAX_BYTES = 16;
/** Adresse d'une affiche, en octets (base : 1 024 ; plus longue réelle : 79) */
export const CLOUD_POSTER_URL_MAX_BYTES = 1024;
/**
 * Numéro du fournisseur envoyé au cloud (épisode suivant, favori, catégorie), en octets (base : 128 ;
 * réel : 7 caractères au plus). Un seul numéro démesuré bloquait en silence tout
 * l'envoi de son domaine.
 */
export const CLOUD_PROVIDER_ID_MAX_BYTES = 128;
/** Nom de profil saisi dans les réglages (base : 400 octets, soit 100 caractères ; plus long nom réel : 15) */
export const PROFILE_NAME_MAX_LENGTH = 50;

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

/**
 * Titre envoyé au cloud : coupé à 500 caractères (il reste entier sur l'appareil). La coupe se fait
 * par caractère entier : couper au milieu d'un emoji laisserait un demi-caractère que la base refuse.
 */
export function cloudTitle(title: string): string {
  if (title.length <= CLOUD_TITLE_MAX_LENGTH) return title;
  return Array.from(title).slice(0, CLOUD_TITLE_MAX_LENGTH).join('');
}

/** Extension envoyée au cloud : une valeur fantaisiste d'un fournisseur ne part pas. */
export function cloudContainerExtension(extension: string | null | undefined): string | null {
  if (!extension || byteLength(extension) > CLOUD_CONTAINER_EXTENSION_MAX_BYTES) return null;
  return extension;
}

/** Affiche envoyée au cloud : une adresse démesurée ne part pas (l'appareil garde la sienne). */
export function fitsCloudPosterUrl(url: string): boolean {
  return byteLength(url) <= CLOUD_POSTER_URL_MAX_BYTES;
}

/** Numéro du fournisseur assez court pour la base. Sinon il reste sur l'appareil et ne part pas. */
export function fitsCloudProviderId(id: string): boolean {
  return byteLength(id) <= CLOUD_PROVIDER_ID_MAX_BYTES;
}

/** Épisode suivant envoyé au cloud : un numéro démesuré part vide (l'appareil garde le sien). */
export function cloudNextEpisodeId(id: string | null | undefined): string | null {
  if (!id || !fitsCloudProviderId(id)) return null;
  return id;
}
