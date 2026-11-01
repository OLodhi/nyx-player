/**
 * Tests : Ma liste n'affiche que la réponse du chargement le plus récent.
 * Deux chargements se croisent : l'ancien, arrivé en dernier, ne remplace pas la liste à jour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { LightIndexes } from '../../types/lightIndex';

type Item = { id: number };
type Pending = { resolve: (items: Item[]) => void; reject: (err: unknown) => void };
const pending: Pending[] = [];
let changeListener: (() => void) | null = null;

vi.mock('../../services/watchlistHydration', () => ({
  toggleWatchlist: vi.fn(),
  getHydratedWatchlist: vi.fn(() => new Promise<Item[]>((resolve, reject) => { pending.push({ resolve, reject }); })),
  onWatchlistChange: (cb: () => void) => { changeListener = cb; return () => { changeListener = null; }; },
}));
vi.mock('../../services/tmdbCacheSqlite', () => ({
  onDetailsUpdate: () => () => {},
}));

import { toggleWatchlist } from '../../services/watchlistHydration';
import { APP_NOTICE_EVENT } from '../../utils/appNotice';
import { useWatchlistData } from '../useWatchlistData';

const indexes = {} as LightIndexes;

describe('useWatchlistData', () => {
  beforeEach(() => {
    pending.length = 0;
    changeListener = null;
  });

  it("ignore une réponse ancienne arrivée après la plus récente", async () => {
    const { result } = renderHook(() => useWatchlistData(indexes));
    expect(pending).toHaveLength(1);

    // Un titre est retiré ailleurs : nouveau chargement
    act(() => { changeListener?.(); });
    expect(pending).toHaveLength(2);

    // La réponse récente (sans le titre retiré) arrive d'abord, l'ancienne ensuite
    await act(async () => { pending[1].resolve([{ id: 2 }]); });
    await act(async () => { pending[0].resolve([{ id: 1 }, { id: 2 }]); });

    expect(result.current.watchlist).toEqual([{ id: 2 }]);
  });

  it('journalise un chargement en échec sans casser la liste affichée', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useWatchlistData(indexes));
    const before = result.current.watchlist;

    await act(async () => { pending[0].reject(new Error('base fermée')); });

    expect(result.current.watchlist).toBe(before);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Bouton Ma liste de l'accueil : l'écriture en échec (base occupée) restait sans effet ni message,
  // et l'erreur partait en rejet non géré
  it('ajout en échec : message bref affiché, aucune erreur non gérée', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(toggleWatchlist).mockRejectedValueOnce(new Error('database is locked'));
    const notices: string[] = [];
    const listen = (e: Event) => notices.push((e as CustomEvent<string>).detail);
    window.addEventListener(APP_NOTICE_EVENT, listen);
    const { result } = renderHook(() => useWatchlistData(indexes));

    await act(async () => { await result.current.handleWatchlistToggle(1, 42, 'movie'); });

    expect(notices).toEqual(['watchlist_update_failed']);
    window.removeEventListener(APP_NOTICE_EVENT, listen);
  });
});
