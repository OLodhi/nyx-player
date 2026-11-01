/**
 * Sortie de l'app à la télécommande : Retour quand plus rien n'est à fermer et que la sélection est
 * déjà sur la barre latérale (ou qu'il n'y a pas de barre : connexion, profils). Le premier appui
 * affiche « Appuyez encore sur Retour pour quitter » ; seul un second appui dans le délai quitte
 * (depuis que l'app s'ouvre sur la barre, un seul Retour la fermait).
 */

/** Délai du second Retour, aussi la durée d'affichage du message. */
export const EXIT_CONFIRM_MS = 2500;

/** Émis sur `window` au premier Retour : le message s'affiche (`components/Common/TvExitNotice.tsx`). */
export const EXIT_ARMED_EVENT = 'nyx:exit-armed';

let armedUntil = 0;

/** Retourne true si ce Retour est consommé (message affiché), false s'il doit quitter l'app. */
export function confirmExit(): boolean {
  const now = Date.now();
  if (now < armedUntil) {
    armedUntil = 0;
    return false;
  }
  armedUntil = now + EXIT_CONFIRM_MS;
  window.dispatchEvent(new CustomEvent(EXIT_ARMED_EVENT));
  return true;
}

/** Oublie un premier appui en attente (désinstallation de la navigation). */
export function resetExitConfirm(): void {
  armedUntil = 0;
}
