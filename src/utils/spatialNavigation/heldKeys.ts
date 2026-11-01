/**
 * Touches maintenues : reconnaître les répétitions, marquées ou non.
 *
 * Android TV (WebView) répète une touche maintenue sans marquer les répétitions (`event.repeat`
 * reste faux). Sans ce suivi, chaque répétition passait pour un nouvel appui : l'appui long sur OK
 * ouvrait aussi la carte, et une flèche maintenue n'était jamais freinée, chaque pas lançant
 * un défilement animé (saccades, puis la sélection qui revient en arrière).
 *
 * Une touche est tenue de son `keydown` à son `keyup`. Le suivi périme après `HELD_STALE_MS` sans
 * répétition (plus que le délai avant la première répétition d'Android, 1,5 s au plus avec le
 * réglage d'accessibilité « délai de pression ») : un relâchement perdu n'avale pas un vrai appui.
 */

const HELD_STALE_MS = 2000;

/** Touche tenue → instant de son dernier `keydown` */
const held = new Map<string, number>();
/** `keydown` reconnus comme répétitions */
const repeats = new WeakSet<KeyboardEvent>();

/**
 * Premier écouteur de `keydown` (fenêtre, phase de capture, posé au démarrage) : marque les
 * répétitions avant tout autre écouteur, y compris ceux du lecteur, qui consomment certaines
 * touches (usePlayerRemote) et ne doivent pas faire perdre le suivi.
 */
export function trackKeyDown(event: KeyboardEvent): void {
  const now = Date.now();
  const since = held.get(event.key);
  if (event.repeat || (since !== undefined && now - since < HELD_STALE_MS)) repeats.add(event);
  held.set(event.key, now);
}

export function trackKeyUp(event: KeyboardEvent): void {
  held.delete(event.key);
}

/** Plus aucune touche tenue (fenêtre quittée, désinstallation). */
export function forgetHeldKeys(): void {
  held.clear();
}

/** Répétition d'une touche maintenue, marquée (`repeat`) ou non (Android TV). */
export function isKeyRepeat(event: KeyboardEvent): boolean {
  return event.repeat || repeats.has(event);
}
