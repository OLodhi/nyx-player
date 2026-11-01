/**
 * Synchro et effacement de l'ancien fournisseur en attente : sans effacement réussi, la
 * synchro ne touche ni aux positions, ni aux favoris TV, ni aux catégories masquées ; Ma liste et
 * les préférences continuent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const settle = vi.fn(async () => true);
const syncPreferences = vi.fn(async () => {});
const syncWatchlist = vi.fn(async () => []);
const syncPlayback = vi.fn(async () => {});
const syncLiveTv = vi.fn(async () => {});
const syncHiddenCategories = vi.fn(async () => {});
vi.mock('../sync/syncPurge', () => ({ settlePendingProviderPurge: () => settle() }));
vi.mock('../sync/syncPreferences', () => ({ syncPreferences: () => syncPreferences() }));
vi.mock('../sync/syncWatchlist', () => ({ syncWatchlist: () => syncWatchlist() }));
vi.mock('../sync/syncPlayback', () => ({ syncPlayback: () => syncPlayback() }));
vi.mock('../sync/syncLiveTv', () => ({ syncLiveTv: () => syncLiveTv() }));
vi.mock('../sync/syncHiddenCategories', () => ({ syncHiddenCategories: () => syncHiddenCategories() }));
vi.mock('../sync/syncPush', () => ({}));
vi.mock('../sync/syncBaseline', () => ({ isSameAccount: () => true }));
const setMeta = vi.fn(async () => {});
vi.mock('../dbCore', () => ({ setMeta: (...args: unknown[]) => setMeta(...(args as [])) }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { syncOnLogin, syncAll } from '../sync/syncService';

beforeEach(() => {
  vi.clearAllMocks();
  settle.mockResolvedValue(true);
});

describe('synchro et effacement de l\'ancien fournisseur', () => {
  it('rien en attente : les cinq types sont synchronisés', async () => {
    await syncOnLogin('compte-a');
    for (const fn of [syncPreferences, syncWatchlist, syncPlayback, syncLiveTv, syncHiddenCategories]) {
      expect(fn).toHaveBeenCalledTimes(1);
    }
  });

  it('effacement encore en échec : à la connexion, seuls Ma liste et les préférences sont synchronisés', async () => {
    settle.mockResolvedValue(false);
    const result = await syncOnLogin('compte-a');

    expect(syncPreferences).toHaveBeenCalledTimes(1);
    expect(syncWatchlist).toHaveBeenCalledTimes(1);
    expect(syncPlayback).not.toHaveBeenCalled();
    expect(syncLiveTv).not.toHaveBeenCalled();
    expect(syncHiddenCategories).not.toHaveBeenCalled();
    // Synchro incomplète : pas notée comme faite
    expect(result.errors.length).toBeGreaterThan(0);
    expect(setMeta).not.toHaveBeenCalledWith('last_synced_at', expect.anything());
  });

  it('effacement encore en échec : pareil pour la synchro pendant la session', async () => {
    settle.mockResolvedValue(false);
    await syncAll('compte-a');

    expect(syncWatchlist).toHaveBeenCalledTimes(1);
    expect(syncPlayback).not.toHaveBeenCalled();
    expect(syncLiveTv).not.toHaveBeenCalled();
    expect(syncHiddenCategories).not.toHaveBeenCalled();
  });

  it('date de dernière synchro notée seulement quand positions et TV en direct ont fini', async () => {
    let finishPlayback: () => void = () => {};
    syncPlayback.mockImplementationOnce(() => new Promise<void>((resolve) => { finishPlayback = resolve; }));

    await syncOnLogin('compte-a'); // l'accueil n'attend pas les positions
    expect(setMeta).not.toHaveBeenCalledWith('last_synced_at', expect.anything());

    finishPlayback();
    await vi.waitFor(() => expect(setMeta).toHaveBeenCalledWith('last_synced_at', expect.any(String)));
  });

  it('positions en échec : date de dernière synchro non notée', async () => {
    syncPlayback.mockRejectedValueOnce(new Error('réseau'));
    const result = await syncOnLogin('compte-a');
    await vi.waitFor(() => expect(result.errors.some((e) => e.includes('Playback'))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setMeta).not.toHaveBeenCalledWith('last_synced_at', expect.anything());
  });
});
