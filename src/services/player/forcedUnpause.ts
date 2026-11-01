/**
 * forcedUnpause.ts — Reprise automatique juste après un chargement de flux.
 *
 * Certains flux IPTV démarrent en pause : mpvBridge relance donc la lecture 500 ms après chaque
 * chargement. Si l'utilisateur met en pause pendant cette demi-seconde, la relance ne doit plus
 * partir : toute demande de pause passée par mpvApi annule la minuterie.
 */

let timer: ReturnType<typeof setTimeout> | null = null;

/** Programme la reprise automatique (remplace celle d'un chargement précédent). */
export function scheduleForcedUnpause(run: () => void, delayMs: number): void {
  cancelForcedUnpause();
  timer = setTimeout(() => {
    timer = null;
    run();
  }, delayMs);
}

/** Pause demandée, arrêt ou nouveau chargement : la reprise automatique en attente est abandonnée. */
export function cancelForcedUnpause(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}
