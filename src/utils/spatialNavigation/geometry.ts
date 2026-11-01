/**
 * Choix de la cible par géométrie : l'élément visuellement le plus proche dans la direction
 * demandée, à la manière du FocusFinder d'Android.
 */

import type { Direction } from './dom';

/** Pénalité appliquée à l'espace latéral entre deux éléments : un élément à côté perd toujours. */
const CROSS_AXIS_WEIGHT = 3;

/** Poids du décalage de centres, pour départager des éléments qui se chevauchent. */
const CENTER_WEIGHT = 0.5;

/**
 * Distance pondérée : l'axe de déplacement compte, l'écart latéral compte triple.
 * La cible doit avoir son centre **au-delà du bord** de l'élément courant, pas seulement de son
 * centre : pendant le défilement animé d'une rangée, les cartes voisines bougent, et un simple
 * écart de centres faisait glisser Haut/Bas en diagonale le long de la même rangée.
 */
function score(from: DOMRect, to: DOMRect, direction: Direction): number | null {
  const fromX = from.left + from.width / 2;
  const fromY = from.top + from.height / 2;
  const toX = to.left + to.width / 2;
  const toY = to.top + to.height / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;

  // Écart latéral : l'espace entre les deux éléments compte triple, le décalage de centres peu.
  // Une petite case à cocher sous un large champ le chevauche : elle ne doit pas perdre contre un
  // lien plus bas mais mieux centré.
  const crossX = gapBetween(from.left, from.right, to.left, to.right) * CROSS_AXIS_WEIGHT + Math.abs(dx) * CENTER_WEIGHT;
  const crossY = gapBetween(from.top, from.bottom, to.top, to.bottom) * CROSS_AXIS_WEIGHT + Math.abs(dy) * CENTER_WEIGHT;

  switch (direction) {
    case 'up':
      return toY < from.top ? -dy + crossX : null;
    case 'down':
      return toY > from.bottom ? dy + crossX : null;
    case 'left':
      return toX < from.left ? -dx + crossY : null;
    case 'right':
      return toX > from.right ? dx + crossY : null;
  }
}

/** Distance entre deux intervalles (0 s'ils se chevauchent). */
function gapBetween(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, bStart - aEnd, aStart - bEnd);
}

/** Chevauchement dans l'axe perpendiculaire au déplacement (le « faisceau » d'Android FocusFinder). */
function inBeam(from: DOMRect, to: DOMRect, direction: Direction): boolean {
  return direction === 'up' || direction === 'down'
    ? to.left < from.right && to.right > from.left
    : to.top < from.bottom && to.bottom > from.top;
}

/** Distance bord à bord dans l'axe du déplacement. */
function edgeDistance(from: DOMRect, to: DOMRect, direction: Direction): number {
  switch (direction) {
    case 'up': return Math.max(0, from.top - to.bottom);
    case 'down': return Math.max(0, to.top - from.bottom);
    case 'left': return Math.max(0, from.left - to.right);
    case 'right': return Math.max(0, to.left - from.right);
  }
}

/**
 * Écart bord à bord jusqu'à un élément entièrement au-delà de `from` dans la direction (Haut/Bas),
 * null s'il n'y est pas : à côté, ou chevauchant la sélection. Sert à ranger les étages par proximité.
 */
export function gapBeyond(from: DOMRect, to: DOMRect, direction: 'up' | 'down'): number | null {
  const beyond = direction === 'down' ? to.top >= from.bottom : to.bottom <= from.top;
  return beyond ? edgeDistance(from, to, direction) : null;
}

/** Distance dans l'axe du déplacement jusqu'au bord le plus éloigné de la cible (`beamBeats` d'Android). */
function farEdgeDistance(from: DOMRect, to: DOMRect, direction: Direction): number {
  switch (direction) {
    case 'up': return Math.max(0, from.top - to.top);
    case 'down': return Math.max(0, to.bottom - from.bottom);
    case 'left': return Math.max(0, from.left - to.left);
    case 'right': return Math.max(0, to.right - from.right);
  }
}

/**
 * Élément suivant dans la direction. Comme Android : les éléments dans le faisceau (qui chevauchent
 * la sélection sur l'axe perpendiculaire) passent d'abord, le plus proche bord à bord l'emportant ;
 * le score pondéré ne sert que s'il n'y en a aucun, ou pour départager une égalité.
 * Sans ça, sous un large champ, une petite case à cocher perdait contre un bouton plus bas mais
 * mieux centré, et devenait inatteignable.
 *
 * Réserve, comme `beamBeats` d'Android : en vertical, un élément hors faisceau qui se termine avant
 * le début du meilleur élément du faisceau passe devant. Sinon, un bouton à gauche entre deux
 * interrupteurs alignés à droite était sauté (fiches et Paramètres, parcours à la télécommande).
 */
export function closest(current: HTMLElement, pool: HTMLElement[], direction: Direction): HTMLElement | null {
  const origin = current.getBoundingClientRect();
  const vertical = direction === 'up' || direction === 'down';
  let bestBeam: HTMLElement | null = null;
  let bestBeamKey: [number, number] | null = null;
  const others: Array<{ element: HTMLElement; rect: DOMRect; value: number }> = [];

  for (const element of pool) {
    if (element === current || element.contains(current) || current.contains(element)) continue;
    const rect = element.getBoundingClientRect();
    const value = score(origin, rect, direction);
    if (value === null) continue;
    if (inBeam(origin, rect, direction)) {
      // Dans le faisceau : distance bord à bord, puis score pour départager
      const key: [number, number] = [edgeDistance(origin, rect, direction), value];
      if (!bestBeamKey || key[0] < bestBeamKey[0] - 0.5 || (Math.abs(key[0] - bestBeamKey[0]) <= 0.5 && key[1] < bestBeamKey[1])) {
        bestBeamKey = key;
        bestBeam = element;
      }
    } else {
      others.push({ element, rect, value });
    }
  }

  if (!bestBeam || !bestBeamKey) {
    return others.reduce<{ element: HTMLElement; value: number } | null>((best, o) => (!best || o.value < best.value ? o : best), null)?.element ?? null;
  }
  if (!vertical) return bestBeam;

  // Haut/Bas : un élément hors faisceau, entièrement au-delà du bord de la sélection et fini avant
  // le début du meilleur du faisceau, passe devant s'il pèse moins (13 × bord à bord² + écart des
  // centres², le poids d'Android) : proche et peu décalé, pas un voisin lointain sur le côté.
  const beamNear = bestBeamKey[0];
  const weight = (rect: DOMRect): number => {
    const edge = edgeDistance(origin, rect, direction);
    const shift = rect.left + rect.width / 2 - (origin.left + origin.width / 2);
    return 13 * edge * edge + shift * shift;
  };
  let winner: HTMLElement | null = null;
  let winnerWeight = weight(bestBeam.getBoundingClientRect());
  for (const { element, rect } of others) {
    const beyond = direction === 'down' ? rect.top >= origin.bottom : rect.bottom <= origin.top;
    if (!beyond || farEdgeDistance(origin, rect, direction) >= beamNear) continue;
    const w = weight(rect);
    if (w < winnerWeight) {
      winner = element;
      winnerWeight = w;
    }
  }
  return winner ?? bestBeam;
}
