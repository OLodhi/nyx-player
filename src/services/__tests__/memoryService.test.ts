/**
 * Tests pour memoryService.ts
 *
 * Vérifient :
 * - requestMemoryPurge() : debounce 1s, réinitialisation du timer
 * - forceMemoryPurge() : appel immédiat, annulation du debounce
 * - Verrou anti-doublon : pas 2 purges en parallèle
 * - Gestion d'erreur invoke
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mock Tauri invoke
// =============================================================================

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// Mock devLog (silencieux en test)
vi.mock('../../utils/devLog', () => ({
  devLog: vi.fn(),
}));

// =============================================================================
// TESTS
// =============================================================================

describe('memoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Par défaut, invoke résout immédiatement
    mockInvoke.mockResolvedValue('ok');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================================================
  // requestMemoryPurge — debounce
  // ===========================================================================

  describe('requestMemoryPurge', () => {
    it('ne déclenche pas invoke immédiatement (debounce)', async () => {
      const { requestMemoryPurge } = await import('../memoryService');
      requestMemoryPurge();
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('déclenche invoke après le délai de 1s', async () => {
      const { requestMemoryPurge } = await import('../memoryService');
      requestMemoryPurge();

      // Avancer le timer de 1s (DEBOUNCE_DELAY_MS)
      vi.advanceTimersByTime(1000);

      // Laisser les microtasks (resolve de invoke) s'exécuter
      await vi.runAllTimersAsync();

      expect(mockInvoke).toHaveBeenCalledWith('trim_memory');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('réinitialise le debounce si appelé plusieurs fois', async () => {
      const { requestMemoryPurge } = await import('../memoryService');

      requestMemoryPurge();
      vi.advanceTimersByTime(500); // 500ms — pas encore le délai
      requestMemoryPurge(); // Réinitialise le timer
      vi.advanceTimersByTime(500); // 500ms de plus (total 1000ms depuis le 2e appel? non, 500ms)

      // À ce stade, seulement 500ms depuis le dernier appel → pas de purge
      expect(mockInvoke).not.toHaveBeenCalled();

      // 500ms de plus → total 1000ms depuis le dernier appel
      vi.advanceTimersByTime(500);
      await vi.runAllTimersAsync();

      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // forceMemoryPurge — immédiat
  // ===========================================================================

  describe('forceMemoryPurge', () => {
    it('appelle invoke immédiatement', async () => {
      const { forceMemoryPurge } = await import('../memoryService');
      forceMemoryPurge();

      // Laisser les microtasks s'exécuter
      await vi.runAllTimersAsync();

      expect(mockInvoke).toHaveBeenCalledWith('trim_memory');
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });

    it('annule un debounce scroll en attente', async () => {
      const { requestMemoryPurge, forceMemoryPurge } = await import('../memoryService');

      requestMemoryPurge(); // Lance un debounce
      forceMemoryPurge();   // Doit annuler le debounce et purger immédiatement

      await vi.runAllTimersAsync();

      // Un seul appel (celui de force), pas celui du debounce
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Verrou anti-doublon
  // ===========================================================================

  describe('verrou anti-doublon', () => {
    it('ignore les appels si une purge est déjà en cours', async () => {
      // invoke qui prend du temps (simule le cycle Low → 3s → Normal)
      let resolveInvoke: () => void;
      mockInvoke.mockImplementation(() => new Promise<string>((resolve) => {
        resolveInvoke = () => resolve('ok');
      }));

      const { forceMemoryPurge } = await import('../memoryService');

      forceMemoryPurge(); // Démarre la purge
      forceMemoryPurge(); // Doit être ignoré (verrou)
      forceMemoryPurge(); // Doit être ignoré (verrou)

      // Résoudre la première purge
      resolveInvoke!();
      await vi.runAllTimersAsync();

      // Seul 1 appel invoke doit avoir été fait
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // Gestion d'erreur
  // ===========================================================================

  describe('gestion erreur', () => {
    it('ne crash pas si invoke échoue', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('WebView2 unavailable'));

      const { forceMemoryPurge } = await import('../memoryService');

      // Ne doit pas throw
      expect(() => forceMemoryPurge()).not.toThrow();

      await vi.runAllTimersAsync();

      // invoke a bien été appelé
      expect(mockInvoke).toHaveBeenCalledWith('trim_memory');
    });
  });

  // ===========================================================================
  // enterPlayerMode / exitPlayerMode
  // ===========================================================================

  describe('enterPlayerMode', () => {
    it('appelle set_memory_low', async () => {
      const { enterPlayerMode } = await import('../memoryService');
      await enterPlayerMode();
      expect(mockInvoke).toHaveBeenCalledWith('set_memory_low');
    });

    it('ne crash pas si invoke échoue', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('COM error'));
      const { enterPlayerMode } = await import('../memoryService');
      await expect(enterPlayerMode()).resolves.not.toThrow();
    });
  });

  describe('exitPlayerMode', () => {
    it('appelle set_memory_normal puis trim_memory (purge)', async () => {
      const { exitPlayerMode } = await import('../memoryService');
      await exitPlayerMode();

      // Laisser le forceMemoryPurge (fire-and-forget) s'exécuter
      await vi.runAllTimersAsync();

      expect(mockInvoke).toHaveBeenCalledWith('set_memory_normal');
      expect(mockInvoke).toHaveBeenCalledWith('trim_memory');
    });

    it('ne crash pas si invoke échoue', async () => {
      mockInvoke.mockRejectedValue(new Error('COM error'));
      const { exitPlayerMode } = await import('../memoryService');
      await expect(exitPlayerMode()).resolves.not.toThrow();
    });
  });
});
