/**
 * Ce que la navigation peut atteindre : éléments activables, visibles, dans le calque au premier
 * plan et dans le piège éventuel. Aussi les petites lectures du DOM partagées par les autres modules.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[role="button"]:not([aria-disabled="true"])',
].join(',');

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Zone = 'content' | 'sidebar' | 'aside';

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Rangées au-dessus ou en dessous de l'écran : atteignables, la cible est ramenée dans la vue
  if (rect.bottom < -window.innerHeight * 3 || rect.top > window.innerHeight * 4) return false;
  const style = getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  // Actions d'une carte : elles apparaissent en fondu à l'ouverture, l'opacité peut être encore à 0.
  // Case à cocher transparente sous un dessin (interrupteurs des Paramètres) : c'est elle que l'on sélectionne.
  return style.opacity !== '0' || element.closest('[data-nav-trap]') !== null || isHiddenCheck(element);
}

function isHiddenCheck(element: Element): boolean {
  return element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
}

function isScrollable(element: HTMLElement): boolean {
  return element.scrollHeight > element.clientHeight + 1;
}

/**
 * Élément sur le parcours : visible, pas retiré (`tabindex="-1"`), pas dans un bloc `inert`, zone de
 * défilement qui déborde. Un panneau fermé qui reste monté (liste de chaînes du lecteur, glissée
 * hors de l'écran) est marqué `inert` : sa transparence est posée sur le panneau, pas sur ses
 * boutons, qui passaient donc pour visibles et attiraient le focus hors de l'écran (Chromecast).
 */
function isNavigable(element: HTMLElement): boolean {
  if (element.getAttribute('tabindex') === '-1') return false;
  if (element.closest('[inert]')) return false;
  if (element.hasAttribute('data-nav-scroll') && !isScrollable(element)) return false;
  return isVisible(element);
}

export function zoneOf(element: Element): Zone {
  const zone = element.closest('[data-nav-zone]')?.getAttribute('data-nav-zone');
  return zone === 'sidebar' || zone === 'aside' ? zone : 'content';
}

/** Calque au premier plan : le dernier visible dans l'ordre du document (portails en fin de body). */
function topLayer(): HTMLElement | null {
  const layers = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-layer]')).filter(isVisible);
  return layers.length > 0 ? layers[layers.length - 1] : null;
}

/**
 * Éléments atteignables depuis `current` : calque au premier plan, puis piège éventuel.
 *
 * Les filtres de calque et de piège passent AVANT `isNavigable` (une lecture de position et de style
 * par élément) : sous une fiche, la page dessous reste dans le DOM avec ses centaines de cartes, et
 * chaque appui sur une flèche les mesurait toutes pour les écarter ensuite (Chromecast). Les
 * trois filtres sont des prédicats purs : le résultat et son ordre ne changent pas.
 */
export function candidates(current: HTMLElement | null): HTMLElement[] {
  const layer = topLayer();
  const allowsSidebar = layer?.getAttribute('data-nav-layer') !== 'modal';
  const trap = current?.closest<HTMLElement>('[data-nav-trap]') ?? null;

  const pool: HTMLElement[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (layer && !layer.contains(el) && !(allowsSidebar && zoneOf(el) === 'sidebar')) continue;
    if (trap && !trap.contains(el)) continue;
    if (isNavigable(el)) pool.push(el);
  }
  return pool;
}

export function currentFocus(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Premier ancêtre qui défile verticalement (page, liste, fiche). */
export function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Conteneur qui défile autour d'un élément, qu'il déborde déjà ou non (page encore courte au montage).
 * Racine des IntersectionObserver des rangées paresseuses : sans elle, la marge d'anticipation est
 * rognée par le conteneur et la rangée suivante n'est montée qu'une fois à l'écran.
 */
export function scrollRoot(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number']);

/** Champ où l'on tape du texte (pas une case à cocher, qui est un `input` elle aussi). */
export function isTextField(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  return element instanceof HTMLTextAreaElement
    || (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type));
}
