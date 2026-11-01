/**
 * Rangées à construire et à libérer autour de la sélection : une devant dans le sens du mouvement, une derrière, la
 * plus proche d'abord ; quatre montées au plus. La fenêtre large d'avant (deux devant, six montées) reste disponible
 * pour les mesures de comparaison.
 */
import { describe, it, expect } from 'vitest';
import { RAIL_WINDOW, WIDE_RAIL_WINDOW, directionOf, isFar, overLimit, rowsAround } from '../railWindow';

describe('fenêtre du rail', () => {
  it('réglage retenu : une rangée d\'avance, une derrière, gardées à deux rangées, quatre montées au plus', () => {
    expect(RAIL_WINDOW).toEqual({ ahead: 1, behind: 1, keep: 2, max: 4 });
    expect(WIDE_RAIL_WINDOW).toEqual({ ahead: 2, behind: 1, keep: 4, max: 6 });
  });

  it('en descendant : la rangée sélectionnée, puis la suivante, puis la précédente', () => {
    expect(rowsAround(5, 1, 40)).toEqual([5, 6, 4]);
    expect(rowsAround(5, 1, 40, WIDE_RAIL_WINDOW)).toEqual([5, 6, 4, 7]);
  });

  it('en remontant : la fenêtre se retourne', () => {
    expect(rowsAround(5, -1, 40)).toEqual([5, 4, 6]);
    expect(rowsAround(5, -1, 40, WIDE_RAIL_WINDOW)).toEqual([5, 4, 6, 3]);
  });

  it('aux bords de l\'accueil : rien hors des catégories', () => {
    expect(rowsAround(0, -1, 40)).toEqual([0, 1]);
    expect(rowsAround(39, 1, 40)).toEqual([39, 38]);
    expect(rowsAround(0, 1, 1)).toEqual([0]);
  });

  it('sens du mouvement : celui du dernier changement de rangée, gardé sur un déplacement latéral', () => {
    expect(directionOf(-1, 3, 1)).toBe(1);
    expect(directionOf(3, 2, 1)).toBe(-1);
    expect(directionOf(2, 2, -1)).toBe(-1);
    expect(directionOf(2, 4, -1)).toBe(1);
  });

  it('trop loin pour être gardée : au-delà de deux rangées (quatre pour la fenêtre large)', () => {
    expect(isFar(12, 10)).toBe(false);
    expect(isFar(13, 10)).toBe(true);
    expect(isFar(7, 10)).toBe(true);
    expect(isFar(14, 10, WIDE_RAIL_WINDOW)).toBe(false);
    expect(isFar(15, 10, WIDE_RAIL_WINDOW)).toBe(true);
  });

  it('plafond : la plus éloignée de la sélection est libérée, seulement au-delà de quatre (six pour la fenêtre large)', () => {
    expect(overLimit([1, 2, 3, 4], 3)).toBeNull();
    expect(overLimit([1, 2, 3, 4, 5], 4)).toBe(1);
    expect(overLimit([9, 10, 11, 2, 12], 11)).toBe(2);
    expect(overLimit([1, 2, 3, 4, 5, 6], 3, WIDE_RAIL_WINDOW)).toBeNull();
    expect(overLimit([1, 2, 3, 4, 5, 6, 7], 6, WIDE_RAIL_WINDOW)).toBe(1);
  });
});
