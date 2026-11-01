/**
 * Carte suivante trouvée sans mesurer la page, dans le rail recyclé de l'accueil Films / Séries TV
 * (components/Iptv/rail).
 *
 * La recherche habituelle mesure chaque élément atteignable de la page (position et style), soit 34 à 53 ms par appui
 * sur une télé quand beaucoup de rangées sont montées. Ici, seul le défilement horizontal des deux rangées est lu :
 * - Gauche / Droite : la carte voisine de la même rangée, par son numéro (`data-index`) ;
 * - Haut / Bas d'une rangée alignée à la rangée alignée voisine : la carte dans l'axe, calculée avec les positions
 *   posées dans le style de chaque carte et le défilement de chaque rangée.
 * Tout autre cas (bout de rangée, rangée voisine encore grise, bannière, barre latérale, fiche ouverte) renvoie null :
 * la recherche habituelle décide. Le choix doit être exactement le sien (test de comparaison).
 */

import type { Direction } from './dom';
import { isTv } from '../platform';
import { rowContentOf, rowPlaceOf } from './rowHost';

const CARD = '.carousel-card';
/** Emplacement d'une catégorie du rail, montée ou non */
const PLACE = '.rail-place';

interface Slot {
  start: number;
  width: number;
  card: HTMLElement;
}

/** Place d'une carte dans sa rangée, d'après son style (`translateX(…px)` et `width`). */
function slotOf(wrapper: HTMLElement): Slot | null {
  const card = wrapper.querySelector<HTMLElement>(`:scope > ${CARD}`);
  const start = /translateX\((-?[\d.]+)px\)/.exec(wrapper.style.transform)?.[1];
  const width = parseFloat(wrapper.style.width);
  if (!card || start === undefined || !Number.isFinite(width)) return null;
  return { start: Number(start), width, card };
}

/** Piste d'une rangée alignée du rail (`data-nav-row`), ou null. */
function alignedTrack(element: Element | null): HTMLElement | null {
  const track = element?.closest<HTMLElement>('[data-nav-row]');
  return track && track.closest('[data-nav-align]') && rowPlaceOf(track, PLACE) ? track : null;
}

function lateral(current: HTMLElement, track: HTMLElement, index: number, direction: 'left' | 'right'): HTMLElement | null {
  const next = index + (direction === 'right' ? 1 : -1);
  if (next < 0) return null;
  const wrapper = track.querySelector<HTMLElement>(`[data-index="${next}"]`);
  const card = wrapper ? slotOf(wrapper)?.card : null;
  return card && card !== current ? card : null;
}

function vertical(track: HTMLElement, from: Slot, direction: 'up' | 'down'): HTMLElement | null {
  // L'emplacement voisin doit porter la piste suivante : un emplacement gris (sans piste) entre les deux, et la
  // recherche habituelle décide. Lu par les voisins directs, sans parcourir toute la page : chercher toutes les pistes
  // à chaque appui coûtait autant que la recherche habituelle
  const own = rowPlaceOf(track, PLACE);
  const sibling = direction === 'down' ? own?.nextElementSibling : own?.previousElementSibling;
  if (!own || !sibling?.matches(PLACE)) return null;
  // Une seule piste dans chacun des deux emplacements : sinon un autre étage est entre les deux
  const inSibling = rowContentOf(sibling).querySelectorAll<HTMLElement>('[data-nav-row]');
  if (inSibling.length !== 1 || rowContentOf(own).querySelectorAll('[data-nav-row]').length !== 1) return null;
  const neighbour = inSibling[0];
  if (alignedTrack(neighbour) !== neighbour) return null;
  // Centre de la carte de départ à l'écran, rapporté au contenu de la rangée d'arrivée (même bord gauche pour toutes
  // les rangées)
  const center = from.start - track.scrollLeft + from.width / 2 + neighbour.scrollLeft;
  let best: Slot | null = null;
  let bestIndex = Infinity;
  let bestOffset = Infinity;
  for (const wrapper of neighbour.querySelectorAll<HTMLElement>('[data-index]')) {
    const slot = slotOf(wrapper);
    if (!slot) continue;
    const index = Number(wrapper.getAttribute('data-index'));
    const offset = Math.abs(slot.start + slot.width / 2 - center);
    // À égalité, la carte la plus à gauche, comme la recherche habituelle
    if (offset < bestOffset || (offset === bestOffset && index < bestIndex)) {
      best = slot;
      bestIndex = index;
      bestOffset = offset;
    }
  }
  return best?.card ?? null;
}

/** Carte suivante trouvée sans mesure, ou null quand la recherche habituelle doit décider. */
export function modelTarget(current: HTMLElement, direction: Direction): HTMLElement | null {
  // Hors TV, une carte a d'autres éléments atteignables (bouton Ma liste) : la recherche habituelle décide
  if (!isTv() || !current.matches(CARD) || current.closest('[data-nav-trap]')) return null;
  // Calque au premier plan (fiche, fenêtre) monté alors que la sélection est encore sur l'accueil : seul son contenu
  // est atteignable, la recherche habituelle le sait
  for (const layer of document.querySelectorAll('[data-nav-layer]')) if (!layer.contains(current)) return null;
  const wrapper = current.parentElement;
  const track = alignedTrack(current);
  if (!wrapper || !track || !wrapper.hasAttribute('data-index') || wrapper.parentElement?.parentElement !== track) return null;
  const from = slotOf(wrapper);
  if (!from || from.card !== current) return null;
  if (direction === 'left' || direction === 'right') return lateral(current, track, Number(wrapper.getAttribute('data-index')), direction);
  return vertical(track, from, direction);
}
