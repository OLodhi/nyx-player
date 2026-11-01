/**
 * Tests unitaires pour epgService — computeEpgProgress
 *
 * Fonction pure — aucun mock nécessaire.
 */

import { describe, it, expect } from 'vitest';
import { computeEpgProgress } from '../../services/epgService';

describe('computeEpgProgress', () => {
  // Programme de 60 min : 1000 → 4600

  it('retourne ~50% pour un programme à mi-parcours', () => {
    const startTs = 1000;
    const stopTs = 4600;   // 3600 secondes = 1h
    const now = 2800;      // milieu = 1000 + 1800 = 2800

    const result = computeEpgProgress(startTs, stopTs, now);
    expect(result).toBe(50);
  });

  it('retourne 0% pour un programme pas encore commencé', () => {
    const startTs = 5000;
    const stopTs = 8600;
    const now = 4000;      // avant le début

    const result = computeEpgProgress(startTs, stopTs, now);
    expect(result).toBe(0);
  });

  it('retourne 100% pour un programme terminé', () => {
    const startTs = 1000;
    const stopTs = 4600;
    const now = 5000;      // après la fin

    const result = computeEpgProgress(startTs, stopTs, now);
    expect(result).toBe(100);
  });

  it('retourne 0% si durée est 0 (start === stop)', () => {
    const result = computeEpgProgress(1000, 1000, 1000);
    expect(result).toBe(0);
  });

  it('retourne 0% si durée est négative (stop < start)', () => {
    const result = computeEpgProgress(5000, 3000, 4000);
    expect(result).toBe(0);
  });
});
