/**
 * Mémorise la position de défilement d'un conteneur, sans la lire à chaque événement.
 *
 * Lire `scrollTop` juste après que l'animation de défilement l'a écrit force une mise en page. Sur la Chromecast,
 * l'ancien écouteur qui le faisait à chaque événement de défilement pesait 12 à 13 % du temps des tâches longues
 * de la descente. Ici l'événement ne fait que (re)armer un minuteur : la position est lue une seule fois, quand le
 * défilement s'arrête.
 */

/** Silence nécessaire avant de lire la position (le défilement animé émet un événement par image). */
export const SCROLL_SAVE_DELAY_MS = 120;

/**
 * Branche l'écouteur sur `container`. `onSave` reçoit la position une fois le défilement arrêté, et au démontage
 * si un défilement était en attente et que le conteneur est encore dans la page. Renvoie la désinscription.
 */
export function trackScrollPosition(container: HTMLElement, onSave: (scrollTop: number) => void): () => void {
  // Par événement : un simple compteur (le défilement animé en émet un par image). Un seul minuteur tourne à la fois,
  // il se réarme tant que des événements arrivent, puis lit la position une fois.
  let events = 0;
  let seen = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const check = () => {
    if (events !== seen) {
      seen = events;
      timer = setTimeout(check, SCROLL_SAVE_DELAY_MS);
      return;
    }
    timer = null;
    onSave(container.scrollTop);
  };
  const onScroll = () => {
    events += 1;
    if (timer === null) {
      seen = events;
      timer = setTimeout(check, SCROLL_SAVE_DELAY_MS);
    }
  };

  container.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    container.removeEventListener('scroll', onScroll);
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    // À appeler dans un nettoyage d'effet de mise en page (useLayoutEffect) : le conteneur est alors encore dans la page
    // et sa position n'a pas encore été remplacée par la restauration d'un autre mode. Déjà retiré : on garde la
    // dernière sauvegarde plutôt qu'un 0 trompeur.
    if (container.isConnected) onSave(container.scrollTop);
  };
}
