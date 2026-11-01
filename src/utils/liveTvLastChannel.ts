/**
 * Dernière chaîne lancée depuis la grille de l'onglet TV : au retour du lecteur, la télécommande
 * retrouve cette chaîne au lieu de la première carte.
 * En mémoire seulement : le focus ne doit pas survivre à un redémarrage de l'appli.
 */

let last: { category: string; streamId: number } | null = null;

export function rememberLaunchedChannel(category: string, streamId: number): void {
  last = { category, streamId };
}

/** Chaîne à retrouver dans cette catégorie, ou null (autre catégorie, rien lancé). */
export function launchedChannelIn(category: string): number | null {
  return last && last.category === category ? last.streamId : null;
}

export function forgetLaunchedChannel(): void {
  last = null;
}
