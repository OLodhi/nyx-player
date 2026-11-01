/**
 * Guide TV à la télécommande : choix de la case suivante (utils/guideTvNavigation.ts).
 */

import { describe, it, expect } from 'vitest';
import type { EpgProgram } from '../../services/epgService';
import { anchorOf, nextGuideCell, programAt, type GuideNavState } from '../guideTvNavigation';

const H = 3600;
const prog = (startH: number, stopH: number): EpgProgram => ({
  channelId: 'c',
  title: `${startH}-${stopH}`,
  startTs: startH * H,
  stopTs: stopH * H,
});

/** Rangée 0 : 18-20, 20-21, 21-23 ; rangée 1 : 19-20.5, 20.5-22 ; rangée 2 : vide ; rangée 3 : 20-22 */
const rows: EpgProgram[][] = [
  [prog(18, 20), prog(20, 21), prog(21, 23)],
  [prog(19, 20.5), prog(20.5, 22)],
  [],
  [prog(20, 22)],
];
const programsOf = (row: number) => rows[row] ?? [];
const NOW = 20.25 * H; // 20 h 15
const state = (anchorTs = NOW, resumePrograms = false): GuideNavState => ({ anchorTs, resumePrograms });
const move = (row: number, startH: number | null, direction: 'up' | 'down' | 'left' | 'right', s = state()) =>
  nextGuideCell({ row, startTs: startH === null ? null : startH * H }, direction, rows.length, programsOf, s, NOW);

describe('programAt', () => {
  it('rend le programme qui couvre l\'heure, sinon le plus proche', () => {
    expect(programAt(rows[0], NOW)?.startTs).toBe(20 * H);
    expect(programAt(rows[1], 23 * H)?.startTs).toBe(20.5 * H);
    expect(programAt(rows[3], 10 * H)?.startTs).toBe(20 * H);
    expect(programAt([], NOW)).toBeUndefined();
  });

  it('l\'heure de fin d\'un programme appartient au suivant', () => {
    expect(programAt(rows[0], 21 * H)?.startTs).toBe(21 * H);
  });
});

describe('anchorOf', () => {
  it('programme en cours : maintenant ; autre programme : son début', () => {
    expect(anchorOf(prog(18, 21), NOW)).toBe(NOW);
    expect(anchorOf(prog(21, 23), NOW)).toBe(21 * H);
    expect(anchorOf(prog(18, 20), NOW)).toBe(18 * H);
  });
});

describe('nextGuideCell', () => {
  it('Droite / Gauche passent au programme suivant / précédent de la chaîne', () => {
    expect(move(0, 20, 'right')?.cell).toEqual({ row: 0, startTs: 21 * H });
    expect(move(0, 20, 'left')?.cell).toEqual({ row: 0, startTs: 18 * H });
  });

  it('Gauche depuis le premier programme mène au logo, puis la grille rend la main', () => {
    expect(move(0, 18, 'left')?.cell).toEqual({ row: 0, startTs: null });
    expect(move(0, null, 'left')).toBeUndefined();
  });

  it('Droite au dernier programme chargé : la sélection reste', () => {
    expect(move(0, 21, 'right')).toEqual({ cell: null, state: state() });
  });

  it('Droite depuis le logo mène au programme de l\'heure suivie', () => {
    expect(move(1, null, 'right')?.cell).toEqual({ row: 1, startTs: 19 * H });
  });

  it('Bas garde l\'heure : du programme en cours au programme en cours de la chaîne suivante', () => {
    const start = move(0, 21, 'left'); // retour sur le programme en cours : heure suivie = maintenant
    expect(start?.state.anchorTs).toBe(NOW);
    const down = move(0, 20, 'down', start?.state);
    expect(down?.cell).toEqual({ row: 1, startTs: 19 * H });
  });

  it('l\'heure suivie ne bouge pas en descendant : un programme court ne la décale pas', () => {
    const right = move(0, 20, 'right'); // 21 h
    expect(right?.state.anchorTs).toBe(21 * H);
    const down = move(0, 21, 'down', right?.state);
    expect(down?.cell).toEqual({ row: 1, startTs: 20.5 * H });
    expect(down?.state.anchorTs).toBe(21 * H);
  });

  it('chaîne sans programme : on passe par son logo et la suivante reprend les programmes', () => {
    const toEmpty = move(1, 20.5, 'down');
    expect(toEmpty?.cell).toEqual({ row: 2, startTs: null });
    expect(toEmpty?.state.resumePrograms).toBe(true);
    const after = move(2, null, 'down', toEmpty?.state);
    expect(after?.cell).toEqual({ row: 3, startTs: 20 * H });
    expect(after?.state.resumePrograms).toBe(false);
  });

  it('dans la colonne des logos, Haut / Bas restent dans les logos', () => {
    expect(move(1, null, 'down')?.cell).toEqual({ row: 2, startTs: null });
    expect(move(1, null, 'up')?.cell).toEqual({ row: 0, startTs: null });
  });

  it('en haut et en bas du guide, la sélection reste', () => {
    expect(move(0, 20, 'up')?.cell).toBeNull();
    expect(move(3, 20, 'down')?.cell).toBeNull();
  });
});
