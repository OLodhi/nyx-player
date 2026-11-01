/**
 * Titre des cartes d'affiche (CarouselCard, CategoryDetailCard) à la télécommande.
 *
 * Sur bureau, le titre et son défilement apparaissent au survol prolongé de la souris. Sur TV, ils apparaissent sur
 * la carte focusée (tv.css) : le titre trop long pour la carte défile en boucle, ce que marque l'attribut
 * `data-title-overflow`, posé ici hors de React (une seule lecture de largeur, aucun rendu à chaque flèche).
 *
 * Sur la WebView d'Android TV, le survol de la souris arrive sans souris : quand la page saute sous le pointeur
 * resté à sa place, la carte qui se retrouve dessous reçoit `mouseenter`, sans `mouseleave` tant que rien ne bouge.
 * Elle restait agrandie avec son titre qui défilait, sans avoir le focus. Sur TV, le survol ne compte donc qu'après
 * un vrai geste de souris (`nyx-pointer`, posé au clic par spatialNavigation et retiré à la première touche).
 */

import { isTv } from '../../utils/platform';

/** Le survol de la souris doit-il ouvrir les détails de la carte ? */
export function hoverOpensDetails(): boolean {
  return !isTv() || document.documentElement.classList.contains('nyx-pointer');
}

/**
 * Carte focusée sur TV : marque le titre qui ne tient pas dans la carte (`data-title-overflow`), pour le faire
 * défiler. `box` : le cadre du titre ; on compare la largeur du texte, marge de la boucle exclue, à celle de son contenu.
 */
export function markTitleOverflow(card: HTMLElement, box: HTMLElement | null): void {
  const text = box?.querySelector<HTMLElement>('.title-text');
  if (!box || !text) return;
  const loopGap = parseFloat(getComputedStyle(text).paddingRight) || 0;
  // Largeur du contenu du cadre : sa marge intérieure (bandeau de « Voir tout ») ne laisse pas de place au texte
  const boxStyle = getComputedStyle(box);
  const room = box.clientWidth - (parseFloat(boxStyle.paddingLeft) || 0) - (parseFloat(boxStyle.paddingRight) || 0);
  card.toggleAttribute('data-title-overflow', text.scrollWidth - loopGap > room);
}

/**
 * Comme `markTitleOverflow`, deux images plus tard, si la carte a toujours le focus ; `done` suit la mesure. Faite
 * dans la flèche, la mesure suit les écritures de la sélection et force le navigateur à recalculer la page ; deux
 * images plus tard, la page vient d'être dessinée et la lecture ne coûte presque rien. Le titre commence à défiler
 * 30 ms plus tard, ce qui ne se voit pas (il attend déjà une seconde avant de bouger, tv.css).
 */
export function markTitleOverflowSoon(card: HTMLElement, box: HTMLElement | null, done?: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (document.activeElement !== card) return;
    markTitleOverflow(card, box);
    done?.();
  }));
}
