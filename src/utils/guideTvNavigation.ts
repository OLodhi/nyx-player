/**
 * Guide TV à la télécommande : choix de la case suivante dans la grille horaire.
 *
 * La grille se parcourt comme celle d'un décodeur, pas par géométrie : Haut / Bas changent de chaîne
 * en restant à la même heure, Gauche / Droite passent au programme précédent / suivant de la chaîne.
 * Au bout à gauche, on arrive sur le logo de la chaîne ; encore à gauche, la navigation habituelle
 * reprend (barre des catégories). Une chaîne sans programme se traverse par son logo.
 */

import type { EpgProgram } from '../services/epgService';
import type { NavMoveDetail } from './spatialNavigation';

type Direction = NavMoveDetail['direction'];

/** Case du guide : logo de la chaîne (`startTs` nul) ou programme (début du programme). */
export interface GuideCell {
  row: number;
  startTs: number | null;
}

/** Mémoire du parcours, gardée d'une touche à l'autre. */
export interface GuideNavState {
  /** Heure suivie par Haut / Bas (secondes) */
  anchorTs: number;
  /** Passé par le logo d'une chaîne sans programme : Haut / Bas reviennent dans les programmes */
  resumePrograms: boolean;
}

/**
 * Résultat d'une touche : `undefined` = la grille laisse la touche à la navigation habituelle,
 * `cell` nul = la sélection reste sur place.
 */
export type GuideMove = { cell: GuideCell | null; state: GuideNavState } | undefined;

/** Programme qui couvre `ts`, sinon le plus proche dans le temps. */
export function programAt(programs: EpgProgram[], ts: number): EpgProgram | undefined {
  let best: EpgProgram | undefined;
  let bestGap = Infinity;
  for (const program of programs) {
    if (program.startTs <= ts && ts < program.stopTs) return program;
    const gap = ts < program.startTs ? program.startTs - ts : ts - program.stopTs + 1;
    if (gap < bestGap) {
      bestGap = gap;
      best = program;
    }
  }
  return best;
}

/**
 * Heure suivie après un déplacement latéral : maintenant pour le programme en cours (Bas mène alors
 * au programme en cours de la chaîne suivante), son début pour les autres.
 */
export function anchorOf(program: EpgProgram, nowSec: number): number {
  return program.startTs <= nowSec && nowSec < program.stopTs ? nowSec : program.startTs;
}

function indexOfStart(programs: EpgProgram[], startTs: number): number {
  return programs.findIndex((p) => p.startTs === startTs);
}

/**
 * Case suivante dans le guide.
 * @param programsOf programmes affichables d'une rangée, triés par début
 */
export function nextGuideCell(
  from: GuideCell,
  direction: Direction,
  rowCount: number,
  programsOf: (row: number) => EpgProgram[],
  state: GuideNavState,
  nowSec: number,
): GuideMove {
  const programs = programsOf(from.row);
  const stay = { cell: null, state };
  const toProgram = (row: number, program: EpgProgram, anchorTs: number) => ({
    cell: { row, startTs: program.startTs },
    state: { anchorTs, resumePrograms: false },
  });

  if (direction === 'left' || direction === 'right') {
    if (from.startTs === null) {
      // Logo : à gauche, on sort de la grille ; à droite, programme à l'heure suivie
      if (direction === 'left') return undefined;
      const target = programAt(programs, state.anchorTs);
      return target ? toProgram(from.row, target, state.anchorTs) : stay;
    }
    const index = indexOfStart(programs, from.startTs);
    const target = programs[direction === 'left' ? index - 1 : index + 1];
    if (index >= 0 && target) return toProgram(from.row, target, anchorOf(target, nowSec));
    if (direction === 'left') return { cell: { row: from.row, startTs: null }, state: { ...state, resumePrograms: false } };
    return stay;
  }

  const row = from.row + (direction === 'down' ? 1 : -1);
  if (row < 0 || row >= rowCount) return stay;
  const inPrograms = from.startTs !== null || state.resumePrograms;
  if (!inPrograms) return { cell: { row, startTs: null }, state };
  const target = programAt(programsOf(row), state.anchorTs);
  if (target) return toProgram(row, target, state.anchorTs);
  // Chaîne sans programme : on passe par son logo, la rangée suivante reprend les programmes
  return { cell: { row, startTs: null }, state: { ...state, resumePrograms: true } };
}
