/**
 * Zones qui défilent (`data-nav-scroll`, synopsis) : OK active les flèches, Retour les rend à la
 * navigation.
 */

import { pushBackHandler } from '../../hooks/useBackHandler';
import type { Direction } from './dom';
import { animateScrollBy } from './scrollAnimator';

/** Pas de défilement d'une zone `data-nav-scroll`, en part de sa hauteur visible. */
const SCROLL_STEP_RATIO = 0.6;

let engaged: { element: HTMLElement; release: () => void } | null = null;

export function disengage(): void {
  if (!engaged) return;
  const { element, release } = engaged;
  engaged = null;
  element.removeAttribute('data-nav-engaged');
  element.removeEventListener('blur', disengage);
  release();
}

function engage(element: HTMLElement): void {
  disengage();
  element.setAttribute('data-nav-engaged', '');
  element.addEventListener('blur', disengage);
  engaged = { element, release: pushBackHandler(() => disengage()) };
}

/** OK sur une zone qui défile : active ses flèches, ou les rend si elles l'étaient déjà. */
export function toggleEngaged(element: HTMLElement): void {
  if (engaged?.element === element) disengage();
  else engage(element);
}

/** La zone a pris les flèches : elles la font défiler au lieu de déplacer le focus. */
export function isEngaged(element: HTMLElement): boolean {
  return engaged !== null && engaged.element === element;
}

/** Haut/Bas font défiler la zone ; Gauche/Droite ne font rien. */
export function scrollEngaged(element: HTMLElement, direction: Direction): void {
  if (direction === 'up' || direction === 'down') {
    const step = element.clientHeight * SCROLL_STEP_RATIO;
    const top = direction === 'down' ? step : -step;
    animateScrollBy(element, { top }); // les appuis répétés s'ajoutent à la cible en cours
  }
}
