/**
 * spatialNavigation — Navigation à la télécommande (Android TV).
 *
 * La WebView ne sait déplacer le focus qu'avec Tab, c'est-à-dire dans l'ordre du DOM : sur une
 * grille de chaînes ou un carrousel, « flèche droite » doit aller à l'élément **visuellement** à
 * droite, pas au suivant dans le code. Ce module choisit donc la cible par géométrie, dans un cadre
 * posé par des attributs (règles de parcours) :
 *
 * - `data-nav-zone="sidebar" | "aside"` : barre latérale, barre de catégories. Haut/Bas restent
 *   dans la zone ; on ne change de zone qu'en butant à gauche ou à droite. On entre dans la barre
 *   latérale par l'icône de la page courante, dans les autres zones par le dernier élément focusé.
 * - `data-nav-layer="page" | "modal"` : calque au premier plan (fiche, fenêtre). Seul son contenu
 *   est atteignable ; une fiche laisse aussi la barre latérale, une fenêtre non.
 * - `data-nav-row` : un étage (boutons de la bannière, carrousel, ligne d'actions d'une fiche).
 *   Haut/Bas en sortent toujours, et y revenir redonne le focus au dernier élément quitté. Des
 *   éléments éparpillés dans le DOM forment un même étage s'ils portent la même valeur.
 * - `data-nav-align` : étages alignés (carrousels de l'accueil). Haut/Bas de l'un à l'autre arrive sur l'élément
 *   dans l'axe de la sélection, jamais sur le dernier élément quitté.
 * - `data-nav-trap` : le focus ne sort pas de l'élément (actions d'une carte). Buter sur un bord
 *   émet `nyx:nav-edge` sur l'élément, qui décide s'il faut sortir.
 * - `data-nav-longpress` : OK court = clic, OK maintenu ≈ 0,5 s = événement `nyx:longpress`.
 *   Valeur `passive` (champ mot de passe) : l'appui court garde son effet natif, sans envoi du formulaire.
 *   OK maintenu ne répète jamais une action : il faut relâcher pour agir de nouveau.
 * - `data-nav-top` : tête de page (bannière d'accueil). La vue y remonte tout en haut ; ailleurs,
 *   l'élément focusé est centré. Sans cible plus bas, la page défile pour charger la rangée suivante.
 * - `data-nav-scroll` : zone qui défile (synopsis). Atteignable seulement si elle déborde ; OK
 *   active le défilement aux flèches, Retour le désactive.
 * - `data-nav-grid` : grille qui choisit elle-même la cible de ses flèches (guide TV). Elle reçoit
 *   `nyx:nav-move` (`NavMoveDetail`) ; si elle l'annule, elle a pris la touche et pose la cible dans
 *   `detail.next` (rien : la sélection reste). Sinon, la navigation habituelle s'applique.
 *
 * - `data-nav-cadence` : page de rangées d'affiches (accueil, « Voir tout », Ma liste, Recherche). Sur TV, des appuis
 *   Haut / Bas plus rapprochés que la touche tenue y attendent leur tour (`TAP_QUEUE_MAX`) ; ailleurs ils restent libres.
 *
 * Retour : celui de la télécommande arrive comme retour Android et passe par `useBackHandler`.
 * Échap et Retour arrière sont mappés sur la même pile (tests au clavier depuis le PC). Quand plus
 * rien n'est à fermer, le focus va sur la barre latérale ; depuis la barre, un premier Retour affiche
 * « Appuyez encore sur Retour pour quitter » et seul un second, dans le délai, quitte l'app.
 *
 * Organisation du dossier :
 * - `dom.ts` : ce qui est atteignable (visibilité, calques, pièges), petites lectures du DOM ;
 * - `geometry.ts` : choix de la cible la plus proche dans une direction ;
 * - `focusMemory.ts` : dernier élément focusé par zone et par étage ;
 * - `findNext.ts` : règles de parcours (zones, étages, pièges) et entrée dans la barre latérale ;
 *   l'arrivée sur une page (`hooks/useTvArrivalFocus.ts`) y pose le focus sur l'icône de la page ;
 * - `viewScroll.ts` : la vue suit la sélection, rangées chargées au défilement ;
 * - `textFields.ts` : clavier système à la demande, sortie latérale d'un champ ;
 * - `scrollZone.ts` : zones qui défilent (synopsis) ;
 * - `heldKeys.ts` : touches maintenues, répétitions reconnues même non marquées (Android TV) ;
 * - `okKey.ts` : OK, appui long ;
 * - `exitConfirm.ts` : second Retour pour quitter l'app ;
 * - `arrowKeys.ts` : flèches et Retour ;
 * - `index.ts` (ici) : installation des écouteurs et API publique.
 */

import { setRootBackFallback } from '../../hooks/useBackHandler';
import { cancelQueue, cancelQueueOnKey, handleKeyDown, resetRepeatThrottle } from './arrowKeys';
import { isTextField } from './dom';
import { focusSidebarEntry } from './findNext';
import { confirmExit, resetExitConfirm } from './exitConfirm';
import { forgetAll, remember } from './focusMemory';
import { cancelAllScrolls } from './scrollAnimator';
import { forgetHeldKeys, trackKeyDown, trackKeyUp } from './heldKeys';
import { cancelPress, handleEnterDown, handleEnterPress, handleEnterUp } from './okKey';
import { disengage } from './scrollZone';
import { keepFieldInView, quietTextField, releaseTextField, wakeTextField } from './textFields';
import { cancelReveal } from './viewScroll';

export { HELD_LATERAL_STEP_MS, HELD_VERTICAL_STEP_MS, REPEAT_MOVE_INTERVAL_MS, TAP_QUEUE_MAX, type NavMoveDetail } from './arrowKeys';
export { EXIT_ARMED_EVENT, EXIT_CONFIRM_MS } from './exitConfirm';
export { zoneOf } from './dom';
export { findNextFocusable, focusActiveSidebarEntry, focusSidebarEntry } from './findNext';
export { isKeyRepeat } from './heldKeys';
export { LONG_PRESS_MS } from './okKey';
export { QUIET_IME_PROPS, quietTextField } from './textFields';

function handleFocusIn(event: FocusEvent): void {
  if (event.target instanceof HTMLElement) remember(event.target);
  // Focus donné par une page (hors navigation) : la prochaine arrivée sur le champ suivra la règle
  quietTextField(event.target instanceof Element ? event.target : null);
}

/** Champ quitté : il retrouve son mode de saisie d'origine, et y revenir ne rouvre pas le clavier. */
function handleFocusOut(event: FocusEvent): void {
  if (!(event.target instanceof Element) || !isTextField(event.target)) return;
  releaseTextField(event.target);
}

/**
 * Souris sous Windows (mode TV de test) : pas de liseré au clic, il revient à la première touche.
 * Toucher un champ, c'est demander le clavier : il lui est rendu avant que le toucher n'agisse.
 */
function handlePointerDown(event: PointerEvent): void {
  document.documentElement.classList.add('nyx-pointer');
  const field = event.target instanceof Element ? event.target.closest('input, textarea') : null;
  if (isTextField(field)) wakeTextField(field);
}

/** Active la navigation directionnelle. Retourne la fonction de désactivation. */
export function installSpatialNavigation(): () => void {
  window.addEventListener('keydown', trackKeyDown, true);
  window.addEventListener('keydown', cancelQueueOnKey, true);
  window.addEventListener('keyup', trackKeyUp, true);
  document.addEventListener('keydown', handleEnterDown, true);
  document.addEventListener('keyup', handleEnterUp, true);
  document.addEventListener('keypress', handleEnterPress, true);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);
  document.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('blur', cancelQueue);
  window.addEventListener('blur', cancelPress);
  window.addEventListener('blur', forgetHeldKeys);
  window.addEventListener('resize', keepFieldInView);
  // Plus rien à fermer : la barre latérale, puis un second Retour pour quitter
  const removeFallback = setRootBackFallback(() => focusSidebarEntry() || confirmExit());

  return () => {
    window.removeEventListener('keydown', trackKeyDown, true);
    window.removeEventListener('keydown', cancelQueueOnKey, true);
    window.removeEventListener('keyup', trackKeyUp, true);
    document.removeEventListener('keydown', handleEnterDown, true);
    document.removeEventListener('keyup', handleEnterUp, true);
    document.removeEventListener('keypress', handleEnterPress, true);
    document.removeEventListener('keydown', handleKeyDown);
    document.removeEventListener('focusin', handleFocusIn);
    document.removeEventListener('focusout', handleFocusOut);
    document.removeEventListener('pointerdown', handlePointerDown, true);
    window.removeEventListener('blur', cancelPress);
    window.removeEventListener('blur', forgetHeldKeys);
    window.removeEventListener('blur', cancelQueue);
    window.removeEventListener('resize', keepFieldInView);
    removeFallback();
    cancelPress();
    forgetHeldKeys();
    cancelReveal();
    disengage();
    forgetAll();
    cancelAllScrolls();
    resetRepeatThrottle();
    resetExitConfirm();
  };
}
