/**
 * Catalogue en attente après une actualisation en arrière-plan : préparé hors lecture,
 * installé au moment calme (changement d'onglet ; 2 minutes sans geste, sauf sur TV), jamais
 * pendant une lecture, jeté si la session a changé.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LightIndexes } from '../../types/lightIndex';

// ============================================================================
// MOCKS
// ============================================================================

let changesSeq = 0;
vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(async () => ({
    select: vi.fn(async () => [{ value: String(changesSeq) }]),
  })),
  getDatabaseFileName: vi.fn(() => dbName),
}));
let dbName: string | null = 'nyx_a.db';

const freshIndexes = { movies: new Map() } as unknown as LightIndexes;
vi.mock('../catalogLight', () => ({ loadLightIndexes: vi.fn(async () => freshIndexes) }));

const mockPrepare = vi.fn(async (indexes: LightIndexes, _options?: unknown) => ({
  indexes, dashboard: { generation: 0, base: null, genres: null },
}));
const mockApply = vi.fn();
vi.mock('../catalogReconcile', () => ({
  prepareRefreshedCatalog: (indexes: LightIndexes, options: unknown) => mockPrepare(indexes, options),
  applyRefreshedCatalog: (...args: unknown[]) => mockApply(...args),
}));

let userId: string | null = 'compte-a';
vi.mock('../syncService', () => ({ getCurrentSyncUserId: () => userId }));

let tv = false;
vi.mock('../../utils/platform', () => ({ isTv: () => tv }));

// ============================================================================
// IMPORTS APRÈS LES MOCKS
// ============================================================================

import {
  IDLE_INSTALL_MS, PREPARED_MAX_AGE_MS, __resetCatalogGateForTests, checkForPendingCatalog,
  clearPendingCatalog, hasPendingCatalog, installPendingCatalog, invalidatePreparedCatalog, markInstalledFromDb,
  preparePendingCatalog, registerCatalogInstaller, waitForCatalogPreparation,
} from '../catalogSwapGate';
import { notifyTabChange } from '../calmMoments';
import { setPlaybackBusy } from '../playbackActivity';

const installer = vi.fn();

/** Changements écrits en arrière-plan puis préparation terminée */
async function pendingAndPrepared(seq = 5): Promise<void> {
  changesSeq = seq;
  await checkForPendingCatalog();
  await preparePendingCatalog();
}

beforeEach(() => {
  __resetCatalogGateForTests();
  setPlaybackBusy(false);
  vi.clearAllMocks();
  changesSeq = 0;
  dbName = 'nyx_a.db';
  userId = 'compte-a';
  tv = false;
  registerCatalogInstaller(installer);
});

afterEach(() => {
  __resetCatalogGateForTests();
  vi.useRealTimers();
});

describe('catalogSwapGate', () => {
  it('rien en attente si la base n\'a pas changé depuis la dernière relecture', async () => {
    markInstalledFromDb(3);
    changesSeq = 3;
    expect(await checkForPendingCatalog()).toBe(false);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('prépare sans rien afficher, puis installe au changement d\'onglet', async () => {
    await pendingAndPrepared();
    expect(hasPendingCatalog()).toBe(true);
    // Préparation sans appel réseau pour l'accueil
    expect(mockPrepare).toHaveBeenCalledWith(freshIndexes, expect.objectContaining({ allowNetwork: false }));
    expect(mockApply).not.toHaveBeenCalled();

    notifyTabChange();
    expect(mockApply).toHaveBeenCalledWith(expect.objectContaining({ indexes: freshIndexes }), installer);
    expect(hasPendingCatalog()).toBe(false);
  });

  it('jamais pendant une lecture ; la préparation est abandonnée au début de la lecture', async () => {
    await pendingAndPrepared();
    setPlaybackBusy(true);
    notifyTabChange();
    expect(mockApply).not.toHaveBeenCalled();
    expect(hasPendingCatalog()).toBe(true);

    // Après la lecture : nouvelle préparation, installée au moment calme suivant
    setPlaybackBusy(false);
    await preparePendingCatalog();
    expect(mockPrepare).toHaveBeenCalledTimes(2);
    notifyTabChange();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('aucune préparation pendant une lecture', async () => {
    setPlaybackBusy(true);
    await pendingAndPrepared();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('installe après 2 minutes sans geste, hors TV', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    await pendingAndPrepared();
    await vi.advanceTimersByTimeAsync(IDLE_INSTALL_MS - 30_000);
    window.dispatchEvent(new KeyboardEvent('keydown'));
    await vi.advanceTimersByTimeAsync(IDLE_INSTALL_MS - 30_000);
    // Une touche a relancé l'attente
    expect(mockApply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('sur TV, pas d\'installation sans geste : seulement au changement d\'onglet', async () => {
    tv = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    await pendingAndPrepared();
    await vi.advanceTimersByTimeAsync(IDLE_INSTALL_MS * 3);
    expect(mockApply).not.toHaveBeenCalled();
    notifyTabChange();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('préparation rendue au bout de 15 minutes, refaite au moment calme suivant', async () => {
    tv = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    await pendingAndPrepared();
    await vi.advanceTimersByTimeAsync(PREPARED_MAX_AGE_MS);
    expect(installPendingCatalog('test')).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockPrepare).toHaveBeenCalledTimes(2);
    expect(installPendingCatalog('test')).toBe(true);
  });

  it('préparation jetée si le compte a changé entre-temps', async () => {
    await pendingAndPrepared();
    userId = 'compte-b';
    notifyTabChange();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('préparation en cours pendant une déconnexion : rien n\'est gardé', async () => {
    changesSeq = 5;
    let finish: () => void = () => {};
    mockPrepare.mockImplementationOnce((indexes) => new Promise((resolve) => {
      finish = () => resolve({ indexes, dashboard: { generation: 0, base: null, genres: null } });
    }));
    await checkForPendingCatalog();
    await vi.waitFor(() => expect(mockPrepare).toHaveBeenCalled());
    clearPendingCatalog();
    finish();
    await vi.waitFor(() => expect(hasPendingCatalog()).toBe(false));
    notifyTabChange();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('la relecture complète par la session (« Actualiser ») remplace la préparation', async () => {
    await pendingAndPrepared(5);
    markInstalledFromDb(5);
    notifyTabChange();
    expect(mockApply).not.toHaveBeenCalled();
    expect(hasPendingCatalog()).toBe(false);
  });

  it('des changements écrits pendant la préparation restent en attente après l\'installation', async () => {
    await pendingAndPrepared(5);
    changesSeq = 8;
    notifyTabChange();
    expect(mockApply).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(2));
    expect(hasPendingCatalog()).toBe(true);
  });

  it('guide TV recalculé : la préparation est refaite, le catalogue reste en attente', async () => {
    await pendingAndPrepared();
    invalidatePreparedCatalog('guide');
    await vi.waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(2));
    await waitForCatalogPreparation();
    expect(hasPendingCatalog()).toBe(true);
    notifyTabChange();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it('guide TV recalculé pendant une préparation : elle est jetée puis refaite', async () => {
    changesSeq = 5;
    let finish: () => void = () => {};
    mockPrepare.mockImplementationOnce((indexes) => new Promise((resolve) => {
      finish = () => resolve({ indexes, dashboard: { generation: 0, base: null, genres: null } });
    }));
    await checkForPendingCatalog();
    await vi.waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(1));
    invalidatePreparedCatalog('guide');
    finish();
    await vi.waitFor(() => expect(mockPrepare).toHaveBeenCalledTimes(2));
    await waitForCatalogPreparation();
    notifyTabChange();
    expect(mockApply).toHaveBeenCalledTimes(1);
  });
});
