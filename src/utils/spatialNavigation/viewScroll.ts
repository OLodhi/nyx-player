/**
 * La vue suit la sélection, et les rangées pas encore chargées sont dévoilées en faisant défiler
 * la page avant de retenter le déplacement.
 */

import { currentFocus, scrollParent } from './dom';
import { findNextFocusable } from './findNext';
import { remember } from './focusMemory';
import {
  animateScrollTo,
  computeRevealTargets,
  settleScroll,
  type RevealTarget,
  deferWhileScrolling,
  isLightScroll,
  isScrollAnimating,
} from './scrollAnimator';
import { quietTextField } from './textFields';

/**
 * La vue suit la sélection par une animation, sur TV comme ailleurs. Sur TV, elle est allégée (scrollAnimator.ts,
 * `isLightScroll`) : ressort plus court, et aucune rangée ni carte ne se monte pendant le mouvement, chaque montage
 * bloquant une petite télé 150 à 180 ms. Le guide TV suit la même règle, logos des chaînes compris
 * (useGuideTvRemote.ts).
 *
 * L'élément est centré verticalement, sauf en tête de page
 * (`data-nav-top` : bannière d'accueil, Suggestions / Films / Séries) où la page remonte tout en haut.
 * Une seule animation par zone (scrollAnimator.ts) : un nouvel appui ou une touche maintenue change sa cible en
 * route, sans jamais en empiler une seconde ni sauter.
 */
export function moveFocus(next: HTMLElement, instant = false): void {
  quietTextField(next); // avant le focus : c'est à ce moment que le clavier s'ouvrirait
  next.focus({ preventScroll: true });
  // Aussi ici qu'à `focusin` : l'événement n'est pas émis tant que la fenêtre n'a pas le focus
  remember(next);
  const top = next.closest('[data-nav-top]') !== null;
  const targets = computeRevealTargets(next, top ? { block: 'nearest', inline: 'nearest' } : { block: 'center', inline: 'nearest' });
  const page = top ? scrollParent(next) : null;
  for (const target of targets) {
    const goal: RevealTarget = target.container === page ? { ...target, top: 0 } : target;
    animateScrollTo(goal.container, { top: goal.top, left: goal.left }, { instant });
  }
  // Tête de page sans défilement de la page à ajuster (déjà tout en haut ou page sans débord) : rien à faire
}

// ---------------------------------------------------------------------------
// Rangées chargées au défilement : sans cible plus bas, on fait défiler puis on réessaie
// ---------------------------------------------------------------------------

const REVEAL_RETRY_MS = 120;
const REVEAL_MAX_ATTEMPTS = 4;
/** Part de la hauteur visible dévoilée à chaque tentative */
const REVEAL_STEP_RATIO = 0.5;

let reveal: {
  from: HTMLElement;
  direction: 'up' | 'down';
  timer?: ReturnType<typeof setTimeout>;
  cancelWait?: () => void;
} | null = null;

export function cancelReveal(): void {
  if (reveal) {
    clearTimeout(reveal.timer);
    reveal.cancelWait?.();
  }
  reveal = null;
}

/** Après `REVEAL_RETRY_MS`, retente le déplacement depuis `from` (ou dévoile un peu plus). */
function retryLater(from: HTMLElement, direction: 'up' | 'down', attempt: number) {
  return setTimeout(() => {
    reveal = null;
    if (currentFocus() !== from) return; // l'utilisateur a bougé entre-temps
    const next = findNextFocusable(from, direction);
    if (next) moveFocus(next, true);
    else if (attempt + 1 < REVEAL_MAX_ATTEMPTS) revealAndRetry(from, direction, attempt + 1);
  }, REVEAL_RETRY_MS);
}

/**
 * Les carrousels de l'accueil ne sont montés qu'à l'approche de l'écran (IntersectionObserver) :
 * la rangée suivante n'existe pas encore quand on appuie sur Bas. On fait défiler la page pour la
 * faire charger, puis on retente le déplacement.
 */
export function revealAndRetry(from: HTMLElement, direction: 'up' | 'down', attempt = 0): void {
  // Touche maintenue : un chargement est déjà en cours depuis ce même élément. Relancer le
  // défilement à chaque répétition emmenait la page tout en bas en laissant le focus derrière.
  if (attempt === 0 && reveal && reveal.from === from && reveal.direction === direction) return;
  cancelReveal();
  const parent = scrollParent(from);
  if (!parent) return;
  // Défilement animé léger : la rangée suivante se monte à la fin du mouvement en cours. On l'attend, au lieu de
  // couper le mouvement et de sauter d'une demi-page
  if (attempt === 0 && isLightScroll() && isScrollAnimating()) {
    const wait: NonNullable<typeof reveal> = { from, direction };
    wait.cancelWait = deferWhileScrolling(() => {
      wait.cancelWait = undefined;
      wait.timer = retryLater(from, direction, attempt);
    });
    reveal = wait;
    return;
  }
  settleScroll(parent); // mesure à l'arrivée, pas en cours de route
  const max = parent.scrollHeight - parent.clientHeight;
  const canScroll = direction === 'down' ? parent.scrollTop < max - 1 : parent.scrollTop > 1;
  if (!canScroll) return;

  // Jamais au point de sortir la sélection de l'écran : au plus, elle arrive au bord de la zone
  const fromRect = from.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const room = direction === 'down' ? fromRect.top - parentRect.top : parentRect.bottom - fromRect.bottom;
  const step = Math.min(parent.clientHeight * REVEAL_STEP_RATIO, room);
  if (step < 1) return;
  parent.scrollBy({ top: direction === 'down' ? step : -step, behavior: 'auto' });
  reveal = { from, direction, timer: retryLater(from, direction, attempt) };
}
