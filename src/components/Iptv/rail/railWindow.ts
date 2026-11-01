/**
 * Quelles rangées du rail (accueil Films / Séries TV) construire et lesquelles libérer, d'après la rangée sélectionnée.
 *
 * Une rangée qui attendait d'arriver près de l'écran pour être construite arrivait grise touche maintenue : le
 * défilement ne s'arrête jamais, et la construction attendait la fin du mouvement. Le rail construit donc d'avance,
 * dans le sens du mouvement, les `ahead` rangées suivantes (et `behind` derrière), la plus proche d'abord. Une
 * rangée à plus de `keep` de la sélection est libérée au repos de la télécommande ; au-delà de `max` rangées
 * montées, la plus éloignée l'est tout de suite : la mémoire reste bornée, quel que soit le nombre de catégories.
 *
 * Réglage retenu après mesure sur une Chromecast : une rangée d'avance et quatre montées au plus, avec les affiches
 * posées au fil du mouvement (navigationRest.ts) : moins de cartes vivantes, moins d'images à garder et à peindre. La
 * fenêtre large d'avant (deux rangées d'avance, six montées) reste disponible pour les mesures de comparaison.
 */

export interface RailWindow {
  /** Rangées construites devant la sélection, dans le sens du mouvement */
  ahead: number;
  /** Rangées construites derrière la sélection */
  behind: number;
  /** Une rangée plus loin que cela de la sélection est libérée au repos */
  keep: number;
  /** Plafond de rangées montées */
  max: number;
}

export const RAIL_WINDOW: Readonly<RailWindow> = Object.freeze({ ahead: 1, behind: 1, keep: 2, max: 4 });
export const WIDE_RAIL_WINDOW: Readonly<RailWindow> = Object.freeze({ ahead: 2, behind: 1, keep: 4, max: 6 });

export type Direction = 1 | -1;

/**
 * Rangées voulues autour de la rangée `focus` (sur `count`), dans l'ordre où les construire : elle d'abord, puis la
 * plus proche, devant puis derrière.
 */
export function rowsAround(focus: number, direction: Direction, count: number, win: RailWindow = RAIL_WINDOW): number[] {
  const wanted = [focus];
  for (let k = 1; k <= Math.max(win.ahead, win.behind); k += 1) {
    if (k <= win.ahead) wanted.push(focus + direction * k);
    if (k <= win.behind) wanted.push(focus - direction * k);
  }
  return wanted.filter((row) => row >= 0 && row < count);
}

/** Sens du mouvement après un passage de la rangée `from` à la rangée `to` (le même, sans changement de rangée). */
export function directionOf(from: number, to: number, previous: Direction): Direction {
  if (from < 0 || from === to) return previous;
  return to > from ? 1 : -1;
}

/** Une rangée trop loin de la sélection pour être gardée (ou construite, quand sa demande arrive en retard). */
export function isFar(row: number, focus: number, win: RailWindow = RAIL_WINDOW): boolean {
  return Math.abs(row - focus) > win.keep;
}

/** Au-delà du plafond, la rangée montée la plus éloignée de la sélection ; sinon null. */
export function overLimit(mounted: readonly number[], focus: number, win: RailWindow = RAIL_WINDOW): number | null {
  if (mounted.length <= win.max) return null;
  let far: number | null = null;
  for (const row of mounted) {
    if (far === null || Math.abs(row - focus) > Math.abs(far - focus)) far = row;
  }
  return far;
}
