/**
 * Tests pour useContinueWatching.ts
 * Vérifie : chargement initial, rafraîchissement sur l'évènement de lecture, échec de lecture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../services/playbackProgressService', () => ({
  getContinueWatching: vi.fn(),
}));

import { getContinueWatching, type PlaybackProgressItem } from '../../services/playbackProgressService';
import { PLAYBACK_EVENT } from '../../services/eventConstants';

const mockGet = vi.mocked(getContinueWatching);

function item(id: string): PlaybackProgressItem {
  return { contentId: id } as unknown as PlaybackProgressItem;
}

// Le cache est un état de module : on recharge le module à chaque test
async function loadHook() {
  vi.resetModules();
  const mod = await import('../useContinueWatching');
  return mod.useContinueWatching;
}

describe('useContinueWatching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Chargement', () => {
    it('renvoie les titres à reprendre une fois lus', async () => {
      mockGet.mockResolvedValue([item('a'), item('b')]);
      const useContinueWatching = await loadHook();
      const { result } = renderHook(() => useContinueWatching());
      expect(result.current.continueWatching).toEqual([]);
      await waitFor(() => expect(result.current.continueWatching).toHaveLength(2));
    });

    it('reste vide quand il n\'y a rien à reprendre', async () => {
      mockGet.mockResolvedValue([]);
      const useContinueWatching = await loadHook();
      const { result } = renderHook(() => useContinueWatching());
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
      expect(result.current.continueWatching).toEqual([]);
    });

    it('garde une liste vide quand la lecture échoue', async () => {
      mockGet.mockRejectedValue(new Error('base indisponible'));
      const useContinueWatching = await loadHook();
      const { result } = renderHook(() => useContinueWatching());
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
      expect(result.current.continueWatching).toEqual([]);
    });

    it('affiche tout de suite la liste précédente au retour sur l\'écran', async () => {
      mockGet.mockResolvedValue([item('a')]);
      const useContinueWatching = await loadHook();
      const first = renderHook(() => useContinueWatching());
      await waitFor(() => expect(first.result.current.continueWatching).toHaveLength(1));
      first.unmount();

      mockGet.mockReturnValue(new Promise(() => {}));
      const second = renderHook(() => useContinueWatching());
      expect(second.result.current.continueWatching).toHaveLength(1);
    });
  });

  describe('Mise à jour', () => {
    it('relit la liste quand la position de lecture change', async () => {
      mockGet.mockResolvedValueOnce([item('a')]);
      const useContinueWatching = await loadHook();
      const { result } = renderHook(() => useContinueWatching());
      await waitFor(() => expect(result.current.continueWatching).toHaveLength(1));

      mockGet.mockResolvedValueOnce([item('b'), item('c')]);
      act(() => {
        window.dispatchEvent(new Event(PLAYBACK_EVENT));
      });
      await waitFor(() => expect(result.current.continueWatching).toHaveLength(2));
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('retire son écouteur d\'évènement de lecture au démontage', async () => {
      mockGet.mockResolvedValue([]);
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const useContinueWatching = await loadHook();
      const { unmount } = renderHook(() => useContinueWatching());
      await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
      const ajoute = add.mock.calls.find((c) => c[0] === PLAYBACK_EVENT);
      expect(ajoute).toBeDefined();
      unmount();
      const retire = remove.mock.calls.find((c) => c[0] === PLAYBACK_EVENT);
      expect(retire?.[1]).toBe(ajoute?.[1]);
      add.mockRestore();
      remove.mockRestore();
    });
  });
});
