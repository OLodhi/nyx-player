/**
 * Champs de texte à la télécommande : clavier système à la demande (arriver sur un champ ne l'ouvre
 * pas, OK l'ouvre ; ANDROID_TV_PLAN.md), sortie latérale au bord du texte, champ gardé en vue
 * quand le clavier s'ouvre.
 */

import { isTextField, type Direction } from './dom';

/**
 * Un champ sélectionné est en lecture seule (pas de clavier) tant qu'on ne l'a pas demandé : le système
 * ouvre le clavier au moment où un champ modifiable prend le focus, la lecture seule est donc posée
 * avant le focus quand c'est la navigation qui le donne, et par `QUIET_IME_PROPS` pour un champ qui
 * prend le focus tout seul (`autoFocus`). OK rend le champ modifiable pendant l'appui, sans empêcher
 * l'effet natif de la touche : c'est Android qui ouvre alors le clavier. Un toucher fait de même.
 *
 * Essais sur l'émulateur TV : `inputmode="none"` ne convient pas (Android garde alors OK
 * pour lui, la page ne le reçoit jamais), et rendre le champ modifiable puis le sélectionner à
 * nouveau par le code n'ouvre pas le clavier.
 */
export const QUIET_IME_ATTR = 'data-nav-quiet-ime';

/** Props d'un champ focalisé d'office sur TV (`autoFocus`) : sélectionné sans ouvrir le clavier. */
export const QUIET_IME_PROPS = { readOnly: true, [QUIET_IME_ATTR]: '' } as const;

/** Champs dont le clavier a été demandé : ils le gardent jusqu'à ce qu'on les quitte. */
const awakeFields = new WeakSet<Element>();

export function quietTextField(element: Element | null): void {
  if (!isTextField(element) || awakeFields.has(element) || element.hasAttribute(QUIET_IME_ATTR) || element.readOnly) return;
  element.setAttribute(QUIET_IME_ATTR, '');
  element.readOnly = true;
}

/** Rend le champ modifiable. Retourne false s'il n'était pas en attente. */
function restoreTextField(element: Element | null): boolean {
  if (!isTextField(element) || !element.hasAttribute(QUIET_IME_ATTR)) return false;
  element.removeAttribute(QUIET_IME_ATTR);
  element.readOnly = false;
  return true;
}

/** Clavier demandé (OK ou toucher) : le champ devient modifiable et le reste tant qu'on ne le quitte pas. */
export function wakeTextField(field: HTMLInputElement | HTMLTextAreaElement): void {
  awakeFields.add(field);
  restoreTextField(field);
}

/** Champ quitté : il retrouve son mode de saisie d'origine, et y revenir ne rouvre pas le clavier. */
export function releaseTextField(field: HTMLInputElement | HTMLTextAreaElement): void {
  awakeFields.delete(field);
  restoreTextField(field);
}

/**
 * Curseur contre le bord du champ, dans la direction demandée : champ vide, ou curseur en tout
 * début (Gauche) ou en toute fin (Droite) sans sélection. Les champs e-mail et nombre n'exposent
 * pas le curseur : ils ne se quittent latéralement que vides.
 */
export function caretAtEdge(field: HTMLInputElement | HTMLTextAreaElement, direction: Direction): boolean {
  if (field.value.length === 0) return true;
  try {
    const { selectionStart, selectionEnd } = field;
    if (selectionStart === null || selectionStart !== selectionEnd) return false;
    return direction === 'left' ? selectionStart === 0 : selectionStart === field.value.length;
  } catch {
    return false;
  }
}

/**
 * Clavier système ouvert : la fenêtre rétrécit (720 → ≈ 400 de haut) et le champ sélectionné pouvait
 * passer sous le bord de sa carte, qui défile (« Mot de passe oublié »). Il est
 * ramené dans la vue, sans animation.
 */
export function keepFieldInView(): void {
  const active = document.activeElement;
  if (!isTextField(active)) return;
  requestAnimationFrame(() => active.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
}
