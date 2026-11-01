/**
 * Mémoire du dernier élément focusé, par zone et par étage : entrer dans une zone ou revenir dans
 * un étage redonne le focus à l'élément quitté.
 */

import { zoneOf, type Zone } from './dom';

/** Dernier élément focusé dans chaque zone, pour y revenir en y entrant. */
const lastFocusByZone = new Map<Zone, HTMLElement>();

/** Étage : valeur de l'attribut si elle est donnée (étage réparti dans le DOM), sinon l'élément. */
type Row = string | Element;

/**
 * `data-nav-blocks="<sélecteur>"` sur un conteneur : chaque élément qui répond au sélecteur est un étage
 * (Paramètres : une option avec son interrupteur, la rangée Rafraîchir / Modifier, un bouton seul).
 * Haut/Bas passent d'un bloc au suivant sans en sauter, Gauche/Droite restent dans le bloc puis sortent
 * vers le menu des pages. Les blocs à champs empilés (compte, formulaire de source) n'en font pas partie.
 */
function blockOf(element: Element): Element | null {
  const container = element.closest('[data-nav-blocks]');
  const selector = container?.getAttribute('data-nav-blocks');
  if (!container || !selector) return null;
  for (let node: Element | null = element; node && node !== container; node = node.parentElement) {
    if (node.matches(selector)) return node;
  }
  return null;
}

export function rowOf(element: Element): Row | null {
  const row = element.closest('[data-nav-row]');
  if (!row) return blockOf(element);
  // JSX écrit un attribut sans valeur `data-nav-row="true"` : ce n'est pas un nom d'étage
  const name = row.getAttribute('data-nav-row');
  return name && name !== 'true' ? name : row;
}

const lastFocusByNamedRow = new Map<string, HTMLElement>();
let lastFocusByRowElement = new WeakMap<Element, HTMLElement>();

function rememberRow(row: Row, element: HTMLElement): void {
  if (typeof row === 'string') lastFocusByNamedRow.set(row, element);
  else lastFocusByRowElement.set(row, element);
}

export function rememberedInRow(row: Row): HTMLElement | undefined {
  return typeof row === 'string' ? lastFocusByNamedRow.get(row) : lastFocusByRowElement.get(row);
}

/** Oublie la carte retenue d'un étage dont le contenu change entièrement (rangée recyclée pour une autre catégorie). */
export function forgetRow(row: Element): void {
  lastFocusByRowElement.delete(row);
}

export function rememberedInZone(zone: Zone): HTMLElement | undefined {
  return lastFocusByZone.get(zone);
}

/**
 * Oublie l'élément retenu d'une zone : y entrer reprend la cible géométrique. L'accueil remis à zéro par
 * son icône (page remontée tout en haut) : Droite va à la bannière, pas sur la carte quittée tout en bas.
 */
export function forgetZone(zone: Zone): void {
  lastFocusByZone.delete(zone);
}

/** Élément d'où l'on est entré dans les points de la bannière : Gauche au bout des points y revient. */
let lateralOnlyOrigin: HTMLElement | null = null;

export function rememberLateralOnlyOrigin(element: HTMLElement): void {
  lateralOnlyOrigin = element;
}

export function lateralOnlyOriginElement(): HTMLElement | null {
  return lateralOnlyOrigin;
}

export function remember(element: HTMLElement): void {
  lastFocusByZone.set(zoneOf(element), element);
  const row = rowOf(element);
  // Un élément « latéral seulement » ne devient pas l'entrée de son étage par Haut/Bas
  if (row && !element.hasAttribute('data-nav-lateral-only')) rememberRow(row, element);
}

/** Oublie tout (désinstallation de la navigation). */
export function forgetAll(): void {
  lateralOnlyOrigin = null;
  lastFocusByZone.clear();
  lastFocusByNamedRow.clear();
  lastFocusByRowElement = new WeakMap();
}
