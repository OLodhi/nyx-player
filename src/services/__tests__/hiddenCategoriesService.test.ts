/**
 * Tests unitaires pour hiddenCategoriesService.ts
 *
 * Vérifie :
 * - Init charge les données SQLite dans le cache
 * - isHidden / getHiddenSet
 * - setAllHidden
 * - resetHiddenCategories / reloadHiddenCategoriesFromDb
 *
 * Toutes les dépendances (DB, syncService) sont mockées.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(() =>
    Promise.resolve({
      select: (...args: unknown[]) => mockSelect(...args),
      execute: (...args: unknown[]) => mockExecute(...args),
    })
  ),
}));

vi.mock('../syncService', () => ({
  batchSyncHiddenCategoriesToCloud: vi.fn().mockResolvedValue(true),
}));

import {
  initHiddenCategories,
  isHidden,
  getHiddenSet,
  setAllHidden,
  resetHiddenCategories,
  reloadHiddenCategoriesFromDb,
} from '../hiddenCategoriesService';

import { batchSyncHiddenCategoriesToCloud } from '../syncService';

describe('hiddenCategoriesService', () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockSelect.mockReset();
    mockExecute.mockResolvedValue(undefined);
    mockSelect.mockResolvedValue([]);
    vi.mocked(batchSyncHiddenCategoriesToCloud).mockClear();
    // Reset le cache interne en appelant resetHiddenCategories
    resetHiddenCategories();
  });

  // ==========================================================================
  // INIT
  // ==========================================================================

  describe('initHiddenCategories', () => {
    it('charge les catégories masquées depuis SQLite', async () => {
      mockSelect.mockResolvedValueOnce([
        { category_id: '42', type: 'movie' },
        { category_id: '7', type: 'live' },
      ]);

      await initHiddenCategories();

      expect(isHidden('42', 'movie')).toBe(true);
      expect(isHidden('7', 'live')).toBe(true);
      expect(isHidden('99', 'movie')).toBe(false);
    });

    it("relit la base à chaque ouverture de session (autre compte, même lancement de l'app)", async () => {
      mockSelect.mockResolvedValueOnce([{ category_id: '1', type: 'movie' }]);
      await initHiddenCategories();

      // Compte suivant : sa propre base, ses propres catégories masquées
      mockSelect.mockResolvedValueOnce([{ category_id: '2', type: 'series' }]);
      await initHiddenCategories();

      expect(isHidden('1', 'movie')).toBe(false); // rien du compte précédent
      expect(isHidden('2', 'series')).toBe(true);
    });

    it('lecture impossible : aucune catégorie héritée de la session précédente', async () => {
      mockSelect.mockResolvedValueOnce([{ category_id: '1', type: 'movie' }]);
      await initHiddenCategories();

      mockSelect.mockRejectedValueOnce(new Error('db closed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await initHiddenCategories();
      consoleSpy.mockRestore();

      expect(isHidden('1', 'movie')).toBe(false);
    });
  });

  // ==========================================================================
  // API LECTURE
  // ==========================================================================

  describe('isHidden / getHiddenSet', () => {
    beforeEach(async () => {
      mockSelect.mockResolvedValueOnce([
        { category_id: '10', type: 'movie' },
        { category_id: '20', type: 'movie' },
        { category_id: '30', type: 'series' },
      ]);
      await initHiddenCategories();
    });

    it('isHidden retourne true/false correctement', () => {
      expect(isHidden('10', 'movie')).toBe(true);
      expect(isHidden('30', 'series')).toBe(true);
      expect(isHidden('10', 'series')).toBe(false); // même ID, type différent
      expect(isHidden('99', 'movie')).toBe(false);
    });

    it('getHiddenSet filtre par type', () => {
      const movieSet = getHiddenSet('movie');
      expect(movieSet.size).toBe(2);
      expect(movieSet.has('10')).toBe(true);
      expect(movieSet.has('20')).toBe(true);

      const seriesSet = getHiddenSet('series');
      expect(seriesSet.size).toBe(1);
      expect(seriesSet.has('30')).toBe(true);

      const liveSet = getHiddenSet('live');
      expect(liveSet.size).toBe(0);
    });

  });

  // ==========================================================================
  // BATCH OPERATIONS
  // ==========================================================================

  describe('setAllHidden', () => {
    beforeEach(async () => {
      mockSelect.mockResolvedValueOnce([
        { category_id: '10', type: 'movie' },
      ]);
      await initHiddenCategories();
    });

    it('remplace les catégories masquées pour un type', async () => {
      await setAllHidden('movie', ['20', '30', '40']);

      expect(isHidden('10', 'movie')).toBe(false); // ancienne, supprimée
      expect(isHidden('20', 'movie')).toBe(true);
      expect(isHidden('30', 'movie')).toBe(true);
      expect(isHidden('40', 'movie')).toBe(true);

      // DELETE all for type, then INSERT each
      expect(mockExecute).toHaveBeenCalledWith(
        'DELETE FROM hidden_categories WHERE type = ?',
        ['movie']
      );
    });

    it('batch sync vers le cloud', async () => {
      await setAllHidden('movie', ['20', '30']);

      expect(batchSyncHiddenCategoriesToCloud).toHaveBeenCalledWith('movie', ['20', '30']);
    });
  });

  // ==========================================================================
  // RESET / RELOAD
  // ==========================================================================

  describe('resetHiddenCategories', () => {
    it('vide le cache mémoire', async () => {
      mockSelect.mockResolvedValueOnce([
        { category_id: '10', type: 'movie' },
      ]);
      await initHiddenCategories();
      expect(getHiddenSet('movie').size).toBe(1);

      resetHiddenCategories();
      expect(getHiddenSet('movie').size).toBe(0);
      expect(isHidden('10', 'movie')).toBe(false);
    });
  });

  describe('reloadHiddenCategoriesFromDb', () => {
    it('recharge les données depuis SQLite', async () => {
      // Init avec des données
      mockSelect.mockResolvedValueOnce([{ category_id: '10', type: 'movie' }]);
      await initHiddenCategories();

      // Reset + reload avec des données différentes
      resetHiddenCategories();
      mockSelect.mockResolvedValueOnce([
        { category_id: '20', type: 'series' },
        { category_id: '30', type: 'live' },
      ]);
      await reloadHiddenCategoriesFromDb();

      expect(isHidden('10', 'movie')).toBe(false); // ancienne donnée effacée
      expect(isHidden('20', 'series')).toBe(true);
      expect(isHidden('30', 'live')).toBe(true);
    });
  });
});
