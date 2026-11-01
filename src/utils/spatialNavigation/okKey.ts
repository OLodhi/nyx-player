/**
 * Touche OK : appui court = clic, appui long ≈ 0,5 s = `nyx:longpress` (`data-nav-longpress`),
 * cases à cocher, zones qui défilent, champs sans clavier. OK maintenu ne répète jamais une action.
 */

import { currentFocus, isTextField } from './dom';
import { isKeyRepeat } from './heldKeys';
import { toggleEngaged } from './scrollZone';
import { QUIET_IME_ATTR, wakeTextField } from './textFields';

/** Durée d'appui sur OK au-delà de laquelle c'est un appui long. */
export const LONG_PRESS_MS = 500;

interface Press {
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout>;
  long: boolean;
  /** `data-nav-longpress="passive"` : le premier appui garde son effet natif (champ de saisie) */
  passive: boolean;
  /** Champ déjà modifiable à l'appui (clavier ouvert) : un appui court le valide, voir `data-nav-enter-next` */
  validating: boolean;
}

let press: Press | null = null;

/**
 * Cet OK vient d'ouvrir le clavier d'un champ : son envoi implicite du formulaire (keypress) est
 * bloqué, comme pour le mot de passe. Sinon la validation du formulaire emportait le focus sur un
 * autre champ avant le relâchement, et le clavier ne s'ouvrait pas (connexion TV, banc Android).
 */
let wakingPress = false;

/**
 * Champ dont l'OK vient d'ouvrir le clavier. Le clavier système absorbe le relâchement de cet OK : sans
 * lui, un OK suivi moins de 2 s après sur un autre élément (Retour, Bas, OK sur le mot de passe)
 * passait pour une répétition de la touche (heldKeys.ts) et était ignoré. Une répétition sur le
 * même champ, elle, reste une répétition.
 */
let wokenField: Element | null = null;

export function cancelPress(): void {
  wakingPress = false;
  wokenField = null;
  if (!press) return;
  clearTimeout(press.timer);
  press = null;
}

/** Phase de capture : passe avant les `onKeyDown` des composants, qui ne voient pas ces OK. */
export function handleEnterDown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;

  // OK maintenu : la télécommande répète la touche, sans toujours le marquer (Android TV :
  // heldKeys.ts). Aucune action ne se répète (sinon un bouton Ma liste s'ajoute et se retire en
  // boucle) ; il faut relâcher pour agir à nouveau.
  const staleWoken = wokenField !== null && !event.repeat && currentFocus() !== wokenField;
  wokenField = null;
  if (isKeyRepeat(event) && !staleWoken) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  // Relâchement jamais reçu (le clavier système peut le prendre) : l'OK précédent ne bloque plus rien
  wakingPress = false;

  const active = currentFocus();
  if (!active) return;

  // Champ sélectionné sans clavier : modifiable dès cet appui, dont l'effet natif (non empêché) ouvre
  // le clavier. Rien d'autre pour ce premier appui (pas de validation de la recherche, qui refermerait
  // le champ), sauf pour un champ à appui long passif (mot de passe), qui garde la suite.
  const validating = isTextField(active) && !active.hasAttribute(QUIET_IME_ATTR);
  if (isTextField(active) && active.hasAttribute(QUIET_IME_ATTR)) {
    wakeTextField(active);
    wakingPress = true;
    wokenField = active;
    if (active.getAttribute('data-nav-longpress') !== 'passive') {
      event.stopPropagation();
      return;
    }
  }

  // Case à cocher : Entrée ne la coche pas nativement, OK doit le faire
  if (active instanceof HTMLInputElement && (active.type === 'checkbox' || active.type === 'radio')) {
    event.preventDefault();
    event.stopPropagation();
    active.click();
    return;
  }

  if (active.hasAttribute('data-nav-scroll')) {
    event.preventDefault();
    event.stopPropagation();
    toggleEngaged(active);
    return;
  }

  // Appui précédent jamais relâché pour la page (relâchement perdu, suivi de OK périmé) : abandonné
  if (press) {
    clearTimeout(press.timer);
    press = null;
  }
  const mode = active.getAttribute('data-nav-longpress');
  if (mode === null) return;
  const passive = mode === 'passive';
  if (!passive) {
    event.preventDefault();
    event.stopPropagation();
  }

  const state: Press = {
    element: active,
    long: false,
    passive,
    validating,
    timer: setTimeout(() => {
      state.long = true;
      active.dispatchEvent(new CustomEvent('nyx:longpress'));
    }, LONG_PRESS_MS),
  };
  press = state;
}

/**
 * Champ mot de passe à appui long passif : l'appui garde son effet natif (clavier virtuel), mais
 * l'envoi implicite du formulaire, déclenché par `keypress`, est bloqué. Sinon, maintenir OK pour
 * afficher le mot de passe enverrait le formulaire à moitié rempli.
 */
export function handleEnterPress(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  const active = currentFocus();
  if (wakingPress || active?.getAttribute('data-nav-longpress') === 'passive') event.preventDefault();
}

export function handleEnterUp(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  wakingPress = false;
  wokenField = null;
  if (!press) return;
  const { element, long, passive, validating } = press;
  cancelPress();
  if (passive) {
    // L'effet natif a déjà eu lieu à l'appui. Clavier déjà ouvert, appui court : le champ est validé
    // et la sélection passe à l'élément qu'il désigne (`data-nav-enter-next` : id), sinon elle reste.
    if (validating && !long) focusEnterNext(element);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (!long) element.click();
}

/** Valide un champ : focus sur l'élément désigné par `data-nav-enter-next` (le clavier se referme). */
function focusEnterNext(field: HTMLElement): void {
  const id = field.getAttribute('data-nav-enter-next');
  const target = id ? document.getElementById(id) : null;
  if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus({ preventScroll: true });
}
