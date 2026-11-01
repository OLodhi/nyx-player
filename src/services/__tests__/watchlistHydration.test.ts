/**
 * Tests unitaires pour watchlistHydration.ts
 *
 * Vérifie que le refactoring event bus (Set → CustomEvent) fonctionne
 * correctement : dispatch, subscribe, unsubscribe.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock des dépendances lourdes (Tauri SQL, TMDB, etc.)
vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(() =>
    Promise.resolve({
      select: vi.fn(() => Promise.resolve([])),
      execute: vi.fn(() => Promise.resolve()),
    })
  ),
}));

vi.mock('../tmdb', () => ({
  tmdb: { imageUrl: vi.fn(() => '') },
}));

import { onWatchlistChange, removeFromWatchlist } from '../watchlistHydration';
import { WATCHLIST_EVENT } from '../eventConstants';

describe('watchlistHydration — Event Bus (CustomEvent)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('onWatchlistChange retourne une fonction de cleanup', () => {
    const callback = vi.fn();
    const cleanup = onWatchlistChange(callback);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('le callback est invoqué quand watchlistUpdated est dispatché', () => {
    const callback = vi.fn();
    const cleanup = onWatchlistChange(callback);

    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    expect(callback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('le cleanup empêche les appels futurs', () => {
    const callback = vi.fn();
    const cleanup = onWatchlistChange(callback);

    cleanup();
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    expect(callback).not.toHaveBeenCalled();
  });




  it('removeFromWatchlist dispatche watchlistUpdated', async () => {
    const callback = vi.fn();
    const cleanup = onWatchlistChange(callback);

    await removeFromWatchlist(123, 456, 'movie');
    expect(callback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('plusieurs listeners reçoivent tous la notification', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cleanup1 = onWatchlistChange(cb1);
    const cleanup2 = onWatchlistChange(cb2);

    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    cleanup1();
    cleanup2();
  });
});
