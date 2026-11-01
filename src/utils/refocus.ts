/**
 * Rend le focus à l'élément visé après le retour du lecteur, seulement s'il est tombé sur le fond :
 * si l'utilisateur a déjà bougé, on ne lui reprend rien. L'élément peut n'être visible qu'à la
 * peinture suivante (la page était cachée pendant la lecture) : quelques images d'essai.
 * Renvoie l'annulation.
 */
const MAX_FRAMES = 12;

export function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

export function refocusWhenLost(selector: string): () => void {
  let frame = 0;
  let raf = 0;
  const attempt = () => {
    if (!focusIsLost()) return;
    const target = document.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus({ preventScroll: true });
      if (document.activeElement === target) return;
    }
    frame += 1;
    if (frame < MAX_FRAMES) raf = requestAnimationFrame(attempt);
  };
  raf = requestAnimationFrame(attempt);
  return () => cancelAnimationFrame(raf);
}
