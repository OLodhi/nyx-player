/**
 * Flèches et Retour : déplacement du focus, cas particuliers (champs, curseurs, zones qui
 * défilent, pièges, fenêtres) et vitesse limitée quand la touche est maintenue.
 */

import { dispatchBack } from '../../hooks/useBackHandler';
import { currentFocus, isTextField, type Direction } from './dom';
import { findNextFocusable } from './findNext';
import { isKeyRepeat } from './heldKeys';
import { isTv } from '../platform';
import { isEngaged, scrollEngaged } from './scrollZone';
import { caretAtEdge } from './textFields';
import { cancelReveal, moveFocus, revealAndRetry } from './viewScroll';
import { noteArrow } from './navigationRest';

/** Touches équivalentes au bouton Retour d'une télécommande sur un clavier. */
const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack', 'GoBack']);

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * Touche maintenue (lecteur) : une action au plus toutes les … ms. La télécommande répète la touche une
 * vingtaine de fois par seconde (un `keydown` toutes les 50 ms après environ 0,4 s).
 */
export const REPEAT_MOVE_INTERVAL_MS = 200;

/**
 * Flèche maintenue dans les pages : un déplacement au plus toutes les … ms, par axe. Sans limite, la sélection
 * filait bien trop vite pour être suivie, et sur une longue liste elle arrivait en bas avant que les affiches
 * aient chargé. Les répétitions en trop sont ignorées, jamais mises en attente : rien ne bouge plus après le
 * relâchement. Plus grand = plus lent.
 *
 * Pas de délai ajouté : le premier appui est immédiat, et la télécommande n'envoie sa première répétition
 * qu'environ 0,4 s plus tard (délai qui confirme que la touche est tenue). Gauche / Droite : des appuis rapprochés à
 * la main (touche relâchée entre deux) ne sont jamais limités. Haut / Bas sur TV : ils ne vont jamais plus vite que
 * la touche tenue (`TAP_QUEUE_MAX`, plus bas).
 *
 * Haut / Bas : une rangée entière par pas, descente lente voulue pour laisser aux affiches le temps de se
 * charger (essais possibles : 300, 350 ou 400).
 */
export const HELD_VERTICAL_STEP_MS = 400;
/**
 * Haut / Bas à la main sur TV, appuis plus rapprochés que la touche tenue : gardés (au plus …) et joués un par un au
 * rythme de la touche tenue, jamais plus vite. Un double appui rapide descendait de deux rangées d'un coup : la vue
 * arrivait sur une rangée pas encore montée (rangée grise), l'appli prenait du retard et rattrapait par à-coups. Comme
 * Leanback (Android TV), les appuis ne sont pas perdus : quelques-uns attendent, les suivants sont ignorés. Une autre
 * touche (Gauche, Droite, OK, Retour, l'autre sens) efface l'attente.
 *
 * Seulement dans les pages de rangées d'affiches (`CADENCE_ZONE`), hors fenêtre et hors champ de texte : ailleurs
 * (réglages, formulaires, commandes du lecteur, fenêtres) il n'y a rien à monter, les appuis restent libres. Auparavant,
 * l'attente s'appliquait partout : dans une fenêtre ou un champ, l'appui gardé était effacé au moment de le jouer
 * (perdu), ailleurs il était retardé (sélection bloquée dans les réglages, les formulaires, le lecteur).
 */
export const TAP_QUEUE_MAX = 3;
/** Pages de rangées d'affiches (accueil, « Voir tout », Ma liste, Recherche) : là seulement, les appuis sont cadencés. */
const CADENCE_ZONE = '[data-nav-cadence]';
/** Gauche / Droite : une affiche par pas, dans un carrousel déjà chargé autour de la sélection. */
export const HELD_LATERAL_STEP_MS = 200;
/**
 * Tolérance sur l'intervalle : les répétitions arrivent toutes les 50 ms à quelques ms près. Sans elle, une
 * répétition en avance de 2 ms sur l'intervalle était écartée et le pas tombait 50 ms plus tard. La moitié de
 * l'écart entre deux répétitions : on prend celle qui tombe à l'intervalle, jamais celle d'avant.
 */
const REPEAT_JITTER_MS = 25;

/** Détail de `nyx:nav-move` : la grille y pose l'élément à sélectionner. */
export interface NavMoveDetail {
  direction: Direction;
  /** Flèche maintenue (la vue suit la sélection d'un mouvement continu, sans animation à empiler) */
  repeat: boolean;
  next: HTMLElement | null;
}

let lastRepeatMoveAt = 0;
let lastVerticalMoveAt = Number.NEGATIVE_INFINITY;
/** Dernier appui gardé rejoué : une répétition qui le suit attend l'intervalle complet */
let lastReplayAt = Number.NEGATIVE_INFINITY;
const queue: {
  direction: Direction | null;
  count: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Élément sélectionné par le dernier pas : si la sélection a bougé autrement, l'attente n'a plus de sens */
  focus: HTMLElement | null;
} = { direction: null, count: 0, timer: null, focus: null };

function clearQueue(): void {
  if (queue.timer !== null) clearTimeout(queue.timer);
  queue.direction = null;
  queue.count = 0;
  queue.timer = null;
  queue.focus = null;
}

/**
 * Premier écouteur de `keydown` (fenêtre, phase de capture, comme le suivi des touches tenues) : une autre touche que
 * celle des appuis gardés efface l'attente, même quand un autre écouteur la consomme ensuite (OK d'une catégorie,
 * zone qui défile, lecteur). Fenêtre quittée : l'attente est effacée aussi.
 */
export function cancelQueueOnKey(event: KeyboardEvent): void {
  if (queue.direction && KEY_TO_DIRECTION[event.key] !== queue.direction) clearQueue();
}

export function cancelQueue(): void {
  clearQueue();
}

export function resetRepeatThrottle(): void {
  lastRepeatMoveAt = 0;
  lastVerticalMoveAt = Number.NEGATIVE_INFINITY;
  lastReplayAt = Number.NEGATIVE_INFINITY;
  clearQueue();
}

/**
 * Haut / Bas cadencés depuis `active` : TV, page de rangées d'affiches, hors fenêtre, grille du guide, zone qui défile
 * et champ de texte (là, Haut / Bas ne sont pas des pas entre rangées).
 */
function cadenced(active: HTMLElement | null): active is HTMLElement {
  return (
    !!active &&
    isTv() &&
    !!active.closest(CADENCE_ZONE) &&
    !active.closest('[data-nav-grid], [data-nav-layer="modal"]') &&
    !isEngaged(active) &&
    !isTextField(active)
  );
}

/** Prochain appui gardé, à son heure : rejoué comme un appui simple depuis la sélection du moment. */
function scheduleQueued(): void {
  if (queue.timer !== null || queue.count === 0 || !queue.direction) return;
  const wait = Math.max(0, lastVerticalMoveAt + HELD_VERTICAL_STEP_MS - REPEAT_JITTER_MS - Date.now());
  queue.timer = setTimeout(() => {
    queue.timer = null;
    const direction = queue.direction;
    const active = currentFocus();
    // Sélection partie ailleurs (fenêtre, lecteur, page), ou arrivée là où Haut / Bas ne sont plus cadencés (zone qui
    // défile, texte, grille du guide, fenêtre, hors des rangées) : les appuis gardés sont oubliés
    const moved = queue.focus !== null && active !== queue.focus;
    if (!direction || queue.count === 0 || moved || !cadenced(active)) {
      clearQueue();
      return;
    }
    queue.count -= 1;
    lastVerticalMoveAt = Date.now();
    lastReplayAt = lastVerticalMoveAt;
    noteArrow();
    move(active, direction, false);
    queue.focus = currentFocus();
    scheduleQueued();
  }, wait);
}

export function handleKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return;
  document.documentElement.classList.remove('nyx-pointer');

  if (BACK_KEYS.has(event.key)) {
    const target = event.target;
    // Retour arrière dans un champ de saisie : c'est une correction de texte, pas un retour
    if (event.key === 'Backspace' && isTextField(target instanceof Element ? target : null)) return;
    event.preventDefault();
    dispatchBack();
    return;
  }

  const direction = KEY_TO_DIRECTION[event.key];
  if (!direction) return;

  const active = currentFocus();

  // Défilement actif : Haut/Bas font défiler la zone, rien ne sort tant que Retour n'est pas pressé
  if (active && isEngaged(active)) {
    event.preventDefault();
    scrollEngaged(active, direction);
    return;
  }

  const vertical = direction === 'up' || direction === 'down';

  // Curseur (taille des sous-titres) : Gauche / Droite changent sa valeur, Haut / Bas le quittent
  if (!vertical && active instanceof HTMLInputElement && active.type === 'range') return;

  // Champ de texte : Gauche/Droite déplacent le curseur et ne quittent le champ qu'en butant sur
  // son bord (sinon, sur la page Recherche, la barre latérale était inatteignable). Haut/Bas le
  // quittent même rempli (sinon, une fois l'e-mail tapé, impossible de descendre au mot de passe),
  // sauf zone multiligne.
  if (isTextField(active)) {
    if (!vertical && !caretAtEdge(active, direction)) return;
    if (vertical && active instanceof HTMLTextAreaElement && active.value.length > 0) return;
  }

  // Flèche maintenue, répétition marquée ou non (Android TV ne marque pas les répétitions : heldKeys.ts)
  const repeat = isKeyRepeat(event);
  const now = Date.now();
  if (repeat) {
    const step = vertical ? HELD_VERTICAL_STEP_MS : HELD_LATERAL_STEP_MS;
    // Haut / Bas : aussi après le dernier appui gardé rejoué, sinon deux pas à 50 ms d'écart
    const last = vertical ? Math.max(lastRepeatMoveAt, lastReplayAt) : lastRepeatMoveAt;
    if (now - last < step - REPEAT_JITTER_MS || (vertical && queue.count > 0)) {
      event.preventDefault();
      return;
    }
    lastRepeatMoveAt = now;
  }

  // Haut / Bas à la main sur TV dans les rangées d'affiches, plus vite que la touche tenue : l'appui attend son tour
  // (TAP_QUEUE_MAX)
  if (vertical && !repeat && cadenced(active)) {
    if (queue.count > 0 || now - lastVerticalMoveAt < HELD_VERTICAL_STEP_MS - REPEAT_JITTER_MS) {
      event.preventDefault();
      if (queue.count === 0) queue.focus = active;
      queue.direction = direction;
      queue.count = Math.min(TAP_QUEUE_MAX, queue.count + 1);
      scheduleQueued();
      return;
    }
  }
  if (vertical) lastVerticalMoveAt = now;

  if (move(active, direction, repeat)) event.preventDefault();
}

/**
 * Déplacement d'un pas depuis `active` (appui, répétition retenue ou appui gardé rejoué). Rend vrai quand la touche
 * est prise (la page ne doit pas la traiter).
 */
function move(active: HTMLElement | null, direction: Direction, repeat: boolean): boolean {
  const vertical = direction === 'up' || direction === 'down';

  // Grille qui choisit elle-même sa cible (guide TV) : elle annule `nyx:nav-move` si elle prend la
  // touche, et désigne la cible dans `detail.next` (sans cible, la sélection reste sur place)
  const grid = active?.closest<HTMLElement>('[data-nav-grid]');
  if (active && grid) {
    const detail: NavMoveDetail = { direction, repeat, next: null };
    if (!grid.dispatchEvent(new CustomEvent('nyx:nav-move', { detail, cancelable: true }))) {
      cancelReveal();
      if (detail.next) moveFocus(detail.next);
      return true;
    }
  }

  const next = findNextFocusable(active, direction);
  if (next) {
    cancelReveal();
    moveFocus(next);
    return true;
  }

  // Bord d'un piège : l'élément piégeant décide (sortir des actions d'une carte…)
  const trap = active?.closest<HTMLElement>('[data-nav-trap]');
  if (trap) {
    trap.dispatchEvent(new CustomEvent('nyx:nav-edge', { detail: { direction } }));
    return true;
  }

  // Fenêtre au premier plan : on bute sur son bord. Faire défiler pour révéler une rangée faisait
  // bouger la page derrière la fenêtre (Chromecast).
  if (active?.closest('[data-nav-layer="modal"]')) return true;

  // Rien plus bas (ou plus haut) : peut-être une rangée pas encore chargée
  if (vertical && active) {
    revealAndRetry(active, direction);
    return true;
  }
  return false;
}
