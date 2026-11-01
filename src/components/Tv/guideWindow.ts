/**
 * guideWindow — Partie du Guide TV à dessiner : les chaînes et les heures à l'écran, avec une marge.
 *
 * Une grosse catégorie comptait ≈ 7 000 éléments (123 chaînes × tous les programmes de la journée),
 * tous dessinés alors qu'une dizaine de chaînes et quelques heures tiennent à l'écran
 * (Chromecast). La grille ne dessine que la fenêtre calculée ici ; des cales gardent la hauteur
 * et la largeur de la grille entière, rien ne change à l'écran.
 *
 * Les bornes avancent par pas (rangées et demi-heures) : la grille se redessine quand on franchit un
 * pas, pas à chaque image du défilement.
 */

import type { GuideCell } from '../../utils/guideTvNavigation';

/** Ce que l'on voit du corps du guide, en pixels de mise en page. */
export interface GuideView {
  scrollTop: number;
  scrollLeft: number;
  width: number;
  height: number;
  /** Hauteur d'une rangée */
  rowPx: number;
  /** Largeur d'une minute de programme */
  pxPerMinute: number;
}

/** Rangées `firstRow`..`lastRow` (incluses), programmes qui touchent [`fromTs`, `toTs`[ (secondes). */
export interface GuideWindow {
  firstRow: number;
  lastRow: number;
  fromTs: number;
  toTs: number;
}

/** Marge minimale au-dessus et au-dessous de l'écran, en rangées (sinon une demi-hauteur d'écran) */
export const MIN_OVERSCAN_ROWS = 3;
/**
 * Les rangées dessinées avancent par … Un pas plus grand = moins de rendus pendant un défilement
 * (Chromecast : avec 2, ≈ 12 rendus en pleine animation, 15 % d'images en retard contre 8 %).
 */
export const ROW_STEP = 6;
/** Marge à gauche et à droite de l'écran, en minutes */
export const TIME_MARGIN_MIN = 90;
/** Les heures dessinées avancent par … minutes */
export const TIME_STEP_MIN = 30;

/** Toute la journée (et les jours chargés) : grille sans taille connue, rien à deviner */
export const ALL_TIME = { fromTs: -Infinity, toTs: Infinity };

/**
 * Fenêtre à dessiner pour une vue. `pins` : cases qui doivent rester dessinées où que soit la vue
 * (la case sélectionnée à la télécommande, celle que la télécommande va sélectionner).
 */
export function guideWindow(
  view: GuideView,
  rowCount: number,
  originTs: number,
  pins: readonly GuideCell[] = [],
  allTime = false,
): GuideWindow {
  const overscan = Math.max(MIN_OVERSCAN_ROWS * view.rowPx, view.height / 2);
  let firstRow = Math.floor(Math.max(0, view.scrollTop - overscan) / view.rowPx / ROW_STEP) * ROW_STEP;
  let lastRow = Math.ceil((view.scrollTop + view.height + overscan) / view.rowPx / ROW_STEP) * ROW_STEP - 1;

  const fromMin = Math.floor((view.scrollLeft / view.pxPerMinute - TIME_MARGIN_MIN) / TIME_STEP_MIN) * TIME_STEP_MIN;
  const toMin = Math.ceil(((view.scrollLeft + view.width) / view.pxPerMinute + TIME_MARGIN_MIN) / TIME_STEP_MIN) * TIME_STEP_MIN;
  let fromTs = allTime ? ALL_TIME.fromTs : originTs + fromMin * 60;
  let toTs = allTime ? ALL_TIME.toTs : originTs + toMin * 60;

  for (const pin of pins) {
    firstRow = Math.min(firstRow, pin.row);
    lastRow = Math.max(lastRow, pin.row);
    if (pin.startTs !== null) {
      fromTs = Math.min(fromTs, pin.startTs);
      toTs = Math.max(toTs, pin.startTs + 60);
    }
  }

  lastRow = Math.min(lastRow, rowCount - 1);
  firstRow = Math.max(0, Math.min(firstRow, lastRow));
  return { firstRow, lastRow, fromTs, toTs };
}

export function sameWindow(a: GuideWindow, b: GuideWindow): boolean {
  return a.firstRow === b.firstRow && a.lastRow === b.lastRow && a.fromTs === b.fromTs && a.toTs === b.toTs;
}

/** Le programme touche la fenêtre (un programme long, commencé avant, y reste). */
export function inTimeWindow(startTs: number, stopTs: number, window: Pick<GuideWindow, 'fromTs' | 'toTs'>): boolean {
  return stopTs > window.fromTs && startTs < window.toTs;
}
