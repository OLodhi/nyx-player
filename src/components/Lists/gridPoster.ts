/**
 * Affiche d'une carte de « Voir tout » sur TV (CategoryDetailCard), au régime des rangées de l'accueil TV
 * (rail/railRow.ts, version C) :
 * - affiche réduite (tvPoster.ts) : TMDB en 185 px, celles du fournisseur réduites par l'appli native ;
 * - en plein mouvement, la carte attend son tour dans la file des affiches (`whenStill`) : la rangée de la sélection
 *   d'abord, puis les cartes à l'écran ; le reste à l'arrêt, quelques-unes par image ;
 * - case grise nue d'ici là : l'image reste dans la carte, sans adresse ni texte de remplacement (tv.css la cache, sinon
 *   Chromium y dessine son icône « image »), et invisible pendant son chargement ; aucun fondu.
 *
 * Écrit hors de React : poser l'adresse d'une affiche ne refait pas le rendu de sa carte.
 */

import { isMoving, isServingWhileMoving, whenStill } from '../../utils/spatialNavigation/navigationRest';
import { fallbackPosterSrc, onPosterSettled, tvPosterSrc } from './tvPoster';

let paced = true;

/**
 * Version de mesure (src/dev/perfVariants.ts) : `false` rend l'affiche d'avant, l'adresse d'origine posée tout de
 * suite même en plein mouvement, témoin des mesures. Lu à la création de chaque carte.
 */
export function setGridPostersPaced(on: boolean): void {
  paced = on;
}

export function areGridPostersPaced(): boolean {
  return paced;
}

/**
 * Ordre des affiches qui attendent leur tour : 0 rangée de la sélection, 1 carte à l'écran, 2 hors de l'écran (servie à
 * l'arrêt). Une rangée de la grille est le parent direct de ses cartes.
 */
export function gridPosterRank(card: HTMLElement): number {
  const active = document.activeElement;
  if (active && card.parentElement?.contains(active)) return 0;
  const box = card.getBoundingClientRect();
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth ? 1 : 2;
}

/**
 * Pose l'affiche `url` dans `img` (image de la carte `card`, rendue sans adresse) à son tour. `onFailed` : ni l'affiche
 * réduite ni l'originale ne se chargent, la carte montre son titre. Renvoie l'annulation (démontage de la carte).
 */
export function attachGridPoster(img: HTMLImageElement, card: HTMLElement, url: string, onFailed: () => void): () => void {
  let cancel: (() => void) | null = null;
  const onLoad = () => {
    img.style.visibility = '';
  };
  // Affiche réduite en échec : l'adresse d'origine, toujours invisible jusqu'à son arrivée ; sinon le titre
  const onError = () => {
    const original = fallbackPosterSrc(img.getAttribute('src') ?? '');
    if (original) img.src = original;
    else onFailed();
  };
  img.addEventListener('load', onLoad);
  img.addEventListener('error', onError);

  const place = (served: boolean) => {
    cancel = null;
    const src = tvPosterSrc(url);
    if (src === null) {
      // Affiche du fournisseur en cours de réduction : case grise d'ici là
      cancel = onPosterSettled(url, () => place(served));
      return;
    }
    if (!served && isMoving() && !isServingWhileMoving()) {
      cancel = whenStill(() => place(true), () => gridPosterRank(card));
      return;
    }
    img.style.visibility = 'hidden';
    img.src = src;
    // Déjà en mémoire : arrivée sans attendre `load`
    if (img.complete && img.naturalWidth > 0) img.style.visibility = '';
  };
  place(false);

  return () => {
    cancel?.();
    cancel = null;
    // Adresse changée sur une carte montée : case grise jusqu'au tour de la nouvelle, pas l'ancienne affiche
    img.removeAttribute('src');
    img.removeEventListener('load', onLoad);
    img.removeEventListener('error', onError);
  };
}
