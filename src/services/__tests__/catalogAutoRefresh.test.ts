/**
 * Actualisation automatique toutes les 12 h : conditions de lancement, arrêt au début d'une
 * lecture, listes retentées seules, base occupée, limitation du fournisseur, arrêt de la session.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RefreshSummary } from '../catalogRefresh';

// ============================================================================
// MOCKS
// ============================================================================

const meta = new Map<string, string>();
const selectMeta = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
  if (sql.includes('FROM meta')) {
    return params.filter((k) => meta.has(k as string)).map((k) => ({ key: k, value: meta.get(k as string) }));
  }
  return [];
};
const fakeDb = {
  select: vi.fn(selectMeta),
  execute: vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('DELETE FROM meta')) meta.delete(params[0] as string);
    else if (sql.startsWith('INSERT OR REPLACE INTO meta')) meta.set(params[0] as string, params[1] as string);
    return { rowsAffected: 1 };
  }),
};
let dbName: string | null = 'nyx_a.db';
vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(async () => fakeDb),
  getDatabaseFileName: vi.fn(() => dbName),
}));

const done = (over: Partial<RefreshSummary> = {}): RefreshSummary => ({
  status: 'done', stopReason: null, retryAfterSec: null, lists: [], failedLists: [],
  progressRelinks: [], epgRelinked: 0, durationMs: 10, bytesDownloaded: 100, ...over,
});
const mockRefresh = vi.fn(async (..._args: unknown[]): Promise<RefreshSummary> => done());
const mockAbort = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../catalogRefresh', () => ({
  nextRefreshRunId: vi.fn(() => 42),
  refreshCatalogDiff: (...args: unknown[]) => mockRefresh(...args),
  abortCatalogRefresh: (...args: unknown[]) => mockAbort(...args),
}));

const mockCheckPending = vi.fn(async () => false);
vi.mock('../catalogSwapGate', () => ({
  checkForPendingCatalog: () => mockCheckPending(),
  clearPendingCatalog: vi.fn(),
  waitForCatalogPreparation: vi.fn(async () => {}),
}));

let syncing = false;
vi.mock('../epgService', () => ({ isSyncing: () => syncing }));

let network = { connected: true, metered: false };
vi.mock('../networkStatus', () => ({ getNetworkStatus: vi.fn(async () => network) }));

const mockSearch = vi.fn(async () => 'none' as const);
vi.mock('../searchIndex', () => ({ applyPendingSearchChanges: () => mockSearch() }));

const mockPushDelete = vi.fn();
const mockPushUpsert = vi.fn();
let userId: string | null = 'compte-a';
vi.mock('../syncService', () => ({
  getCurrentSyncUserId: () => userId,
  pushPlaybackDeleteToCloud: (...args: unknown[]) => mockPushDelete(...args),
  pushPlaybackUpsertToCloud: (...args: unknown[]) => mockPushUpsert(...args),
}));

vi.mock('../../dev/perfHook', () => ({ PERF_ENABLED: false }));

// ============================================================================
// IMPORTS APRÈS LES MOCKS
// ============================================================================

import {
  AUTO_REFRESH_META, BUSY_RETRY_MS, FIRST_CHECK_DELAY_MS, AFTER_PLAYBACK_DELAY_MS, REFRESH_INTERVAL_MS,
  __resetAutoRefreshForTests, getAutoRefreshInfo, RETRY_DELAYS_MS, runCheck, setAutoRefreshEnabled, startCatalogAutoRefresh,
  stopCatalogAutoRefresh, updateAutoRefreshCredentials, clearAutoRefreshNotes, listsToRetry, noteListsToRetry,
} from '../catalogAutoRefresh';
import { setPlaybackBusy } from '../playbackActivity';
import { stopBackgroundWork } from '../backgroundWork';

const creds = { host: 'http://fournisseur', username: 'u', password: 'p' };
const session = () => ({ creds, dbName: 'nyx_a.db', userId: 'compte-a' });
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeEach(() => {
  __resetAutoRefreshForTests();
  setPlaybackBusy(false);
  vi.clearAllMocks();
  mockRefresh.mockReset().mockImplementation(async () => done());
  fakeDb.select.mockReset().mockImplementation(selectMeta);
  meta.clear();
  meta.set('lastProvider', creds.host);
  dbName = 'nyx_a.db';
  userId = 'compte-a';
  syncing = false;
  network = { connected: true, metered: false };
});

afterEach(() => {
  __resetAutoRefreshForTests();
  vi.useRealTimers();
});

describe('catalogAutoRefresh — conditions', () => {
  it('lance un passage complet quand la dernière actualisation a plus de 12 h', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(13));
    startCatalogAutoRefresh(session());
    await runCheck('test');

    expect(mockRefresh).toHaveBeenCalledWith(42, creds, 'nyx_a.db', []);
    expect(Date.parse(meta.get(AUTO_REFRESH_META.lastUpdate)!)).toBeGreaterThan(Date.now() - 5000);
    // Changements pas encore affichés : la porte du catalogue prend le relais
    expect(mockCheckPending).toHaveBeenCalled();
    expect(mockSearch).toHaveBeenCalled();
  });

  it('ne fait rien si la dernière actualisation a moins de 12 h', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(11));
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('ne fait rien quand le réglage est coupé', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(20));
    meta.set(AUTO_REFRESH_META.enabled, '0');
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('jamais pendant une lecture', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(20));
    startCatalogAutoRefresh(session());
    setPlaybackBusy(true);
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('jamais sur une connexion limitée ni hors ligne', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(20));
    startCatalogAutoRefresh(session());
    network = { connected: true, metered: true };
    await runCheck('test');
    network = { connected: false, metered: false };
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('attend la fin de la mise à jour du guide TV, puis réessaie 10 minutes plus tard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(20));
    startCatalogAutoRefresh(session());
    syncing = true;
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();

    syncing = false;
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('attend la date de fin d\'une limitation du fournisseur', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(20));
    meta.set(AUTO_REFRESH_META.retryAfter, String(Date.now() + 60_000));
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('une minute hors de la version du banc (10 s seulement avec VITE_BANC=1)', () => {
    expect(import.meta.env.VITE_BANC).not.toBe('1');
    expect(FIRST_CHECK_DELAY_MS).toBe(60_000);
  });

  it('première vérification une minute après l\'ouverture de la session, pas avant', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    startCatalogAutoRefresh(session());
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1000);
    expect(mockRefresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('écrit la clé du fournisseur si la base est plus ancienne qu\'elle', async () => {
    meta.delete('lastProvider');
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(meta.get('lastProvider')).toBe(creds.host);
  });
});

describe('catalogAutoRefresh — lecture', () => {
  it('une lecture qui commence arrête le passage ; nouvel essai 5 minutes après la fin', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    let finish: (s: RefreshSummary) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    startCatalogAutoRefresh(session());
    const check = runCheck('test');
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    setPlaybackBusy(true);
    expect(mockAbort).toHaveBeenCalledWith(42);
    finish(done({ status: 'aborted', stopReason: 'page' }));
    await check;
    // Arrêté par la page : pas de date écrite, la prochaine vérification relance
    expect(meta.has(AUTO_REFRESH_META.lastUpdate)).toBe(false);
    // Recherche jamais mise à jour pendant la lecture
    expect(mockSearch).toHaveBeenCalledTimes(1);

    setPlaybackBusy(false);
    await vi.advanceTimersByTimeAsync(AFTER_PLAYBACK_DELAY_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('catalogAutoRefresh — échecs', () => {
  it('listes en échec retentées seules, de plus en plus tard (5, 15, 60 min), puis 12 h au 4e échec', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    mockRefresh.mockResolvedValue(done({ status: 'partial', failedLists: ['series'] }));
    startCatalogAutoRefresh(session());
    const min = 60_000;

    await runCheck('1');
    expect(meta.get(AUTO_REFRESH_META.retryLists)).toBe('["series"]');
    expect(meta.get(AUTO_REFRESH_META.retryCount)).toBe('1');
    expect(meta.has(AUTO_REFRESH_META.lastUpdate)).toBe(false);
    expect(Number(meta.get(AUTO_REFRESH_META.retryAfter))).toBe(Date.now() + RETRY_DELAYS_MS[0]);

    // Jamais avant l'attente, même au retour dans l'app ou à la vérification horaire
    await vi.advanceTimersByTimeAsync(4 * min);
    await runCheck('trop tôt');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    // L'essai suivant est planifié tout seul à la fin de l'attente
    await vi.advanceTimersByTimeAsync(1 * min + 1000);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(mockRefresh).toHaveBeenLastCalledWith(42, creds, 'nyx_a.db', ['series']);
    expect(meta.get(AUTO_REFRESH_META.retryCount)).toBe('2');

    await vi.advanceTimersByTimeAsync(14 * min);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1 * min + 1000);
    expect(mockRefresh).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(59 * min);
    expect(mockRefresh).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1 * min + 1000);
    expect(mockRefresh).toHaveBeenCalledTimes(4);

    // 4e échec : retour au rythme de 12 h, au plus 4 essais par fenêtre de 12 h
    expect(meta.has(AUTO_REFRESH_META.retryLists)).toBe(false);
    expect(meta.has(AUTO_REFRESH_META.retryAfter)).toBe(false);
    expect(meta.get(AUTO_REFRESH_META.lastError)).toBe('partial');
    await vi.advanceTimersByTimeAsync(11 * 60 * min);
    expect(mockRefresh).toHaveBeenCalledTimes(4);
    // Passage normal à la vérification horaire qui suit les 12 h
    mockRefresh.mockResolvedValue(done());
    await vi.advanceTimersByTimeAsync(2 * 60 * min);
    expect(mockRefresh).toHaveBeenCalledTimes(5);
    expect(mockRefresh).toHaveBeenLastCalledWith(42, creds, 'nyx_a.db', []);
  });

  it('une erreur de l\'appel compte comme un échec de toutes les listes', async () => {
    mockRefresh.mockRejectedValueOnce(new Error('réseau'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(meta.get(AUTO_REFRESH_META.retryLists)).toBe('["categories","movies","series","live"]');
    warn.mockRestore();
  });

  it('limitation du fournisseur : au moins une heure d\'attente', async () => {
    mockRefresh.mockResolvedValueOnce(done({ status: 'rate_limited', retryAfterSec: 60 }));
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(Number(meta.get(AUTO_REFRESH_META.retryAfter))).toBeGreaterThanOrEqual(Date.now() + 3600_000 - 5000);
  });

  it('base occupée par une écriture lourde : nouvel essai 10 minutes plus tard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    mockRefresh.mockResolvedValueOnce(done({ status: 'busy' }));
    startCatalogAutoRefresh(session());
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(meta.has(AUTO_REFRESH_META.lastUpdate)).toBe(false);
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS);
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it('reprises re-liées à un nouveau numéro : le cloud suit', async () => {
    mockRefresh.mockResolvedValueOnce(done({ progressRelinks: [{ from: 1, to: 2 }] }));
    fakeDb.select.mockImplementation(async (sql: string, params: unknown[] = []) => (sql.includes('FROM meta')
      ? selectMeta(sql, params)
      : [{ tmdb_id: 9, title: 'Film', poster_url: null, time_seconds: 60, duration_seconds: 600, container_extension: 'mkv' }]));
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockPushDelete).toHaveBeenCalledWith(1);
    expect(mockPushUpsert).toHaveBeenCalledWith(2, 'movie', expect.objectContaining({ tmdb_id: 9, time_seconds: 60 }));
  });
});

// Une connexion ou un « Actualiser » où la liste des films a échoué
// écrivait quand même la date de mise à jour ; la section Films attendait alors 12 h.
describe('catalogAutoRefresh — listes en échec d\'une lecture complète', () => {
  it('traduit les échecs du Rust en listes, sans retenter une liste gardée pour chute TMDB', () => {
    expect(listsToRetry(['movies', 'movies_guarded', 'vod_categories', 'live_guarded'])).toEqual(['categories', 'movies', 'live']);
    expect(listsToRetry(['series_categories_guarded', 'series'])).toEqual(['categories', 'series']);
    // Catégories toujours retentées avec leurs éléments (gardées avec eux par le Rust)
    expect(listsToRetry(['movies', 'movies_guarded'])).toEqual(['categories', 'movies']);
    expect(listsToRetry(['movies_tmdb_guarded', 'series_tmdb_guarded'])).toEqual([]);
    expect(listsToRetry([])).toEqual([]);
  });

  it('liste des films en échec à la connexion : retentée dès la première vérification, sans attendre 12 h', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(0));
    await noteListsToRetry(['movies', 'movies_guarded']);
    expect(meta.get(AUTO_REFRESH_META.retryLists)).toBe('["categories","movies"]');

    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockRefresh).toHaveBeenCalledWith(42, creds, 'nyx_a.db', ['categories', 'movies']);
  });

  it('se reconnecter ne relance pas une série d\'essais : compte et attente gardés', async () => {
    meta.set(AUTO_REFRESH_META.lastUpdate, hoursAgo(0));
    meta.set(AUTO_REFRESH_META.retryCount, '3');
    meta.set(AUTO_REFRESH_META.retryAfter, String(Date.now() + 30 * 60_000));
    await noteListsToRetry(['movies']);
    expect(meta.get(AUTO_REFRESH_META.retryCount)).toBe('3');

    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('liste gardée pour chute TMDB : rien n\'est noté', async () => {
    await noteListsToRetry(['movies_tmdb_guarded']);
    expect(meta.has(AUTO_REFRESH_META.retryLists)).toBe(false);
  });

  it('lecture complète sans échec : les notes d\'un passage précédent sont effacées', async () => {
    meta.set(AUTO_REFRESH_META.retryLists, '["series"]');
    meta.set(AUTO_REFRESH_META.retryCount, '2');
    meta.set(AUTO_REFRESH_META.retryAfter, String(Date.now() + 60_000));
    await noteListsToRetry([]);
    expect(meta.has(AUTO_REFRESH_META.retryLists)).toBe(false);
    expect(meta.has(AUTO_REFRESH_META.retryCount)).toBe(false);
    expect(meta.has(AUTO_REFRESH_META.retryAfter)).toBe(false);
  });
});

describe('catalogAutoRefresh — session', () => {
  it('changement de compte pendant l\'envoi des reprises : plus rien ne part au cloud', async () => {
    mockRefresh.mockResolvedValueOnce(done({ progressRelinks: [{ from: 1, to: 2 }, { from: 3, to: 4 }] }));
    fakeDb.select.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM meta')) return selectMeta(sql, params);
      userId = 'compte-b';
      return [{ tmdb_id: 9, title: 'Film', poster_url: null, time_seconds: 60, duration_seconds: 600, container_extension: 'mkv' }];
    });
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(mockPushDelete).toHaveBeenCalledTimes(1);
    expect(mockPushUpsert).not.toHaveBeenCalled();
  });


  it('l\'arrêt coupe le passage en cours et attend qu\'il rende la main', async () => {
    let finish: (s: RefreshSummary) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    startCatalogAutoRefresh(session());
    void runCheck('test');
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled());

    let stopped = false;
    const stop = stopCatalogAutoRefresh().then(() => { stopped = true; });
    expect(mockAbort).toHaveBeenCalledWith(42);
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(done({ status: 'aborted', stopReason: 'page' }));
    await stop;
    expect(stopped).toBe(true);
    // Session fermée : rien n'est écrit ni préparé
    expect(mockCheckPending).not.toHaveBeenCalled();
  });

  it('la déconnexion Supabase arrête aussi l\'actualisation', async () => {
    let finish: (s: RefreshSummary) => void = () => {};
    mockRefresh.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    startCatalogAutoRefresh(session());
    void runCheck('test');
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const stop = stopBackgroundWork();
    expect(mockAbort).toHaveBeenCalledWith(42);
    finish(done());
    await stop;
    expect(meta.has(AUTO_REFRESH_META.lastUpdate)).toBe(false);
  });

  it('autre compte ou autre base entre-temps : rien n\'est écrit', async () => {
    mockRefresh.mockImplementationOnce(async () => {
      userId = 'compte-b';
      return done();
    });
    startCatalogAutoRefresh(session());
    await runCheck('test');
    expect(meta.has(AUTO_REFRESH_META.lastUpdate)).toBe(false);
    expect(mockCheckPending).not.toHaveBeenCalled();
  });

  it('nouveau mot de passe chez le même fournisseur : le passage suivant l\'utilise', async () => {
    startCatalogAutoRefresh(session());
    const next = { ...creds, password: 'nouveau' };
    updateAutoRefreshCredentials(next);
    await runCheck('test');
    expect(mockRefresh).toHaveBeenCalledWith(42, next, 'nyx_a.db', []);
  });
});

describe('catalogAutoRefresh — Paramètres', () => {
  it('lit le réglage, la date et les conseils', async () => {
    const when = Date.now() - REFRESH_INTERVAL_MS;
    meta.set(AUTO_REFRESH_META.lastUpdate, new Date(when).toISOString());
    meta.set(AUTO_REFRESH_META.manualAdvised, '1');
    expect(await getAutoRefreshInfo()).toEqual({ enabled: true, lastUpdate: when, lastError: null, manualAdvised: true });

    await setAutoRefreshEnabled(false);
    expect((await getAutoRefreshInfo()).enabled).toBe(false);
    await setAutoRefreshEnabled(true);
    expect(meta.get(AUTO_REFRESH_META.enabled)).toBe('1');
  });

  it('« Actualiser » réussi efface les essais en attente et le conseil', async () => {
    meta.set(AUTO_REFRESH_META.retryLists, '["live"]');
    meta.set(AUTO_REFRESH_META.manualAdvised, '1');
    meta.set(AUTO_REFRESH_META.lastError, 'partial');
    await clearAutoRefreshNotes();
    expect(meta.has(AUTO_REFRESH_META.retryLists)).toBe(false);
    expect(meta.has(AUTO_REFRESH_META.manualAdvised)).toBe(false);
    expect(meta.has(AUTO_REFRESH_META.lastError)).toBe(false);
  });
});
