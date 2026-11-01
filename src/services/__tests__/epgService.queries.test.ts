/**
 * epgService : requêtes SQL du guide (maintenant, jour, maintenant+suivant), purges,
 * synchro réussie ou en erreur et décision de la synchro automatique au lancement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  db: {
    select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
  },
  getDatabaseFileName: vi.fn<() => string | null>(),
  setMeta: vi.fn(),
  refreshConnection: vi.fn(),
  isEpgEnabled: vi.fn(),
  isEpgWifiOnly: vi.fn(),
  getNetworkStatus: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: h.listen }));
vi.mock('../dbCore', () => ({
  getDatabase: async () => h.db,
  getDatabaseFileName: h.getDatabaseFileName,
  refreshConnection: h.refreshConnection,
  setMeta: h.setMeta,
}));
vi.mock('../preferencesService', () => ({
  getDnsProvider: () => 'system',
  isEpgEnabled: h.isEpgEnabled,
  isEpgWifiOnly: h.isEpgWifiOnly,
}));
vi.mock('../networkStatus', () => ({ getNetworkStatus: h.getNetworkStatus }));

import {
  getBatchNowPrograms,
  getDayPrograms,
  getNowAndNextProgram,
  purgeExpiredPrograms,
  purgeEpgData,
  checkAndAutoSync,
  syncEpg,
  isSyncing,
  waitForSyncEnd,
  requestSyncAbort,
  cancelAbort,
} from '../epgService';
import { EPG_UPDATED_EVENT } from '../eventConstants';

const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);
const NOW = NOW_MS / 1000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  h.db.select.mockResolvedValue([]);
  h.db.execute.mockResolvedValue(undefined);
  h.getDatabaseFileName.mockReturnValue('nyx_a.db');
  h.setMeta.mockResolvedValue(undefined);
  h.refreshConnection.mockResolvedValue(undefined);
  h.isEpgEnabled.mockReturnValue(true);
  h.isEpgWifiOnly.mockReturnValue(false);
  h.getNetworkStatus.mockResolvedValue({ metered: false, type: 'wifi' });
  h.listen.mockResolvedValue(() => {});
});

afterEach(() => {
  h.invoke.mockReset();
  vi.useRealTimers();
});

describe('getBatchNowPrograms', () => {
  it('renvoie une carte vide sans requête quand il n\'y a aucune chaîne', async () => {
    const map = await getBatchNowPrograms([]);
    expect(map.size).toBe(0);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('interroge les chaînes demandées avec l\'heure courante et calcule la progression', async () => {
    h.db.select.mockResolvedValueOnce([
      { channel_id: 'a.fr', title: 'Journal', start_ts: NOW - 600, stop_ts: NOW + 600 },
    ]);
    const map = await getBatchNowPrograms(['a.fr', 'b.fr']);
    const [sql, params] = h.db.select.mock.calls[0];
    expect(sql).toContain('channel_id IN (?,?)');
    expect(params).toEqual(['a.fr', 'b.fr', NOW, NOW]);
    expect(map.get('a.fr')).toEqual({ title: 'Journal', startTs: NOW - 600, stopTs: NOW + 600, progress: 50 });
  });

  it('garde seulement le premier programme d\'une chaîne', async () => {
    h.db.select.mockResolvedValueOnce([
      { channel_id: 'a.fr', title: 'Premier', start_ts: NOW - 100, stop_ts: NOW + 100 },
      { channel_id: 'a.fr', title: 'Doublon', start_ts: NOW - 50, stop_ts: NOW + 200 },
    ]);
    const map = await getBatchNowPrograms(['a.fr']);
    expect(map.get('a.fr')?.title).toBe('Premier');
  });

  it('découpe en lots de 500 identifiants', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    await getBatchNowPrograms(ids);
    expect(h.db.select).toHaveBeenCalledTimes(3);
    expect(h.db.select.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([502, 502, 3]);
  });

  it('renvoie une carte vide si la table est absente', async () => {
    h.db.select.mockRejectedValueOnce(new Error('no such table'));
    const map = await getBatchNowPrograms(['a.fr']);
    expect(map.size).toBe(0);
  });
});

describe('getDayPrograms', () => {
  it('renvoie une carte vide sans requête quand il n\'y a aucune chaîne', async () => {
    expect((await getDayPrograms([], NOW)).size).toBe(0);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('borne la requête à 24 h et groupe les programmes par chaîne dans l\'ordre reçu', async () => {
    const midnight = Date.UTC(2026, 9, 1) / 1000;
    h.db.select.mockResolvedValueOnce([
      { channel_id: 'a.fr', title: 'P1', start_ts: midnight - 1800, stop_ts: midnight + 1800 },
      { channel_id: 'a.fr', title: 'P2', start_ts: midnight + 1800, stop_ts: midnight + 3600 },
      { channel_id: 'b.fr', title: 'Q1', start_ts: midnight, stop_ts: midnight + 600 },
    ]);
    const map = await getDayPrograms(['a.fr', 'b.fr'], midnight);
    expect(h.db.select.mock.calls[0][1]).toEqual(['a.fr', 'b.fr', midnight + 86400, midnight]);
    expect(map.get('a.fr')?.map((p) => p.title)).toEqual(['P1', 'P2']);
    expect(map.get('a.fr')?.[0]).toEqual({
      channelId: 'a.fr', title: 'P1', startTs: midnight - 1800, stopTs: midnight + 1800,
    });
    expect(map.get('b.fr')).toHaveLength(1);
  });

  it('fusionne les résultats de plusieurs lots pour une même chaîne', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `c${i}`);
    h.db.select
      .mockResolvedValueOnce([{ channel_id: 'c0', title: 'A', start_ts: 1, stop_ts: 2 }])
      .mockResolvedValueOnce([{ channel_id: 'c0', title: 'B', start_ts: 2, stop_ts: 3 }]);
    const map = await getDayPrograms(ids, 0);
    expect(h.db.select).toHaveBeenCalledTimes(2);
    expect(map.get('c0')?.map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('renvoie une carte vide si la table est absente', async () => {
    h.db.select.mockRejectedValueOnce(new Error('no such table'));
    expect((await getDayPrograms(['a.fr'], 0)).size).toBe(0);
  });
});

describe('getNowAndNextProgram', () => {
  it('renvoie des valeurs nulles sans identifiant, sans toucher la base', async () => {
    expect(await getNowAndNextProgram('')).toEqual({ now: null, next: null });
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('renvoie le programme en cours (avec description) puis le suivant à 0 %', async () => {
    h.db.select
      .mockResolvedValueOnce([{
        channel_id: 'a.fr', title: 'Film', description: 'Un film', start_ts: NOW - 300, stop_ts: NOW + 900,
      }])
      .mockResolvedValueOnce([{
        channel_id: 'a.fr', title: 'Série', description: null, start_ts: NOW + 900, stop_ts: NOW + 1800,
      }]);
    const res = await getNowAndNextProgram('a.fr');
    expect(h.db.select.mock.calls[0][1]).toEqual(['a.fr', NOW, NOW]);
    expect(h.db.select.mock.calls[1][1]).toEqual(['a.fr', NOW]);
    expect(res.now).toEqual({
      title: 'Film', description: 'Un film', startTs: NOW - 300, stopTs: NOW + 900, progress: 25,
    });
    expect(res.next).toEqual({
      title: 'Série', description: undefined, startTs: NOW + 900, stopTs: NOW + 1800, progress: 0,
    });
  });

  it('renvoie seulement le suivant quand rien n\'est en cours', async () => {
    h.db.select
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ channel_id: 'a.fr', title: 'Plus tard', description: '', start_ts: NOW + 10, stop_ts: NOW + 20 }]);
    const res = await getNowAndNextProgram('a.fr');
    expect(res.now).toBeNull();
    expect(res.next?.title).toBe('Plus tard');
    expect(res.next?.description).toBeUndefined();
  });

  it('garde le programme en cours si la lecture du suivant échoue', async () => {
    h.db.select
      .mockResolvedValueOnce([{ channel_id: 'a.fr', title: 'Film', description: null, start_ts: NOW - 10, stop_ts: NOW + 10 }])
      .mockRejectedValueOnce(new Error('KO'));
    const res = await getNowAndNextProgram('a.fr');
    expect(res.now?.title).toBe('Film');
    expect(res.next).toBeNull();
  });
});

describe('purges du guide', () => {
  it('supprime les programmes terminés avant maintenant', async () => {
    await purgeExpiredPrograms();
    expect(h.db.execute).toHaveBeenCalledWith('DELETE FROM epg_programs WHERE stop_ts < ?', [NOW]);
  });

  it('ignore une erreur de purge des programmes expirés', async () => {
    h.db.execute.mockRejectedValueOnce(new Error('no such table'));
    await expect(purgeExpiredPrograms()).resolves.toBeUndefined();
  });

  it('vide programmes, chaînes et état de synchro puis prévient l\'interface', async () => {
    const spy = vi.fn();
    window.addEventListener(EPG_UPDATED_EVENT, spy);
    await purgeEpgData();
    window.removeEventListener(EPG_UPDATED_EVENT, spy);
    const sqls = h.db.execute.mock.calls.map((c) => c[0]);
    expect(sqls[0]).toBe('DELETE FROM epg_programs');
    expect(sqls[1]).toBe('DELETE FROM epg_channels');
    expect(sqls[2]).toContain('epg_sync_status');
    expect(sqls[2]).toContain('epg_auto_sync_paused_until');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('prévient quand même l\'interface si la base échoue', async () => {
    h.db.execute.mockRejectedValueOnce(new Error('KO'));
    const spy = vi.fn();
    window.addEventListener(EPG_UPDATED_EVENT, spy);
    await purgeEpgData();
    window.removeEventListener(EPG_UPDATED_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('syncEpg', () => {
  it('télécharge le guide, recycle la connexion et renvoie les compteurs', async () => {
    h.invoke.mockResolvedValueOnce({ programs_count: 120, channels_count: 8, duration_ms: 345 });
    const spy = vi.fn();
    window.addEventListener(EPG_UPDATED_EVENT, spy);
    const res = await syncEpg();
    window.removeEventListener(EPG_UPDATED_EVENT, spy);
    expect(res).toEqual({ programsCount: 120, channelsCount: 8, durationMs: 345 });
    expect(h.setMeta).toHaveBeenCalledWith('epg_sync_status', 'syncing');
    expect(h.invoke).toHaveBeenCalledWith('fetch_and_parse_epg', expect.objectContaining({
      dbName: 'nyx_a.db', dnsProvider: 'system',
    }));
    expect(h.refreshConnection).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(isSyncing()).toBe(false);
  });

  it('relaie la progression et détache l\'écouteur à la fin', async () => {
    const unlisten = vi.fn();
    let handler: ((e: { payload: unknown }) => void) | undefined;
    h.listen.mockImplementationOnce(async (_name: string, cb: (e: { payload: unknown }) => void) => {
      handler = cb;
      return unlisten;
    });
    h.invoke.mockImplementationOnce(async () => {
      handler?.({ payload: { phase: 'parse', progress: 40 } });
      return { programs_count: 1, channels_count: 1, duration_ms: 1 };
    });
    const onProgress = vi.fn();
    await syncEpg(onProgress);
    expect(h.listen).toHaveBeenCalledWith('epg-progress', expect.any(Function));
    expect(onProgress).toHaveBeenCalledWith({ phase: 'parse', progress: 40 });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('refuse une seconde synchro pendant qu\'une est en cours', async () => {
    let finish: (v: unknown) => void = () => {};
    h.invoke.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const first = syncEpg();
    await vi.advanceTimersByTimeAsync(0);
    expect(isSyncing()).toBe(true);
    await expect(syncEpg()).rejects.toThrow('already in progress');
    finish({ programs_count: 0, channels_count: 0, duration_ms: 0 });
    await first;
    expect(isSyncing()).toBe(false);
  });

  it('échoue sans appeler Rust quand aucun utilisateur n\'est connecté', async () => {
    h.getDatabaseFileName.mockReturnValue(null);
    await expect(syncEpg()).rejects.toThrow('No database name');
    expect(h.invoke).not.toHaveBeenCalled();
    expect(isSyncing()).toBe(false);
  });

  it('marque l\'état en erreur quand le téléchargement échoue', async () => {
    h.invoke.mockRejectedValueOnce(new Error('réseau coupé'));
    await expect(syncEpg()).rejects.toThrow('réseau coupé');
    expect(h.setMeta).toHaveBeenLastCalledWith('epg_sync_status', 'error');
    expect(isSyncing()).toBe(false);
  });

  it('demande l\'arrêt à Rust et purge le guide quand l\'utilisateur l\'a demandé', async () => {
    let finish: (v: unknown) => void = () => {};
    h.invoke.mockImplementation((cmd: string) =>
      cmd === 'fetch_and_parse_epg' ? new Promise((r) => { finish = r; }) : Promise.resolve());
    const run = syncEpg();
    await vi.advanceTimersByTimeAsync(0);
    requestSyncAbort();
    expect(h.invoke).toHaveBeenCalledWith('abort_epg_sync');
    finish({ programs_count: 5, channels_count: 5, duration_ms: 9 });
    expect(await run).toEqual({ programsCount: 0, channelsCount: 0, durationMs: 9 });
    expect(h.db.execute.mock.calls.some((c) => c[0] === 'DELETE FROM epg_programs')).toBe(true);
  });

  it('cancelAbort prévient Rust et laisse la synchro aller au bout', async () => {
    let finish: (v: unknown) => void = () => {};
    h.invoke.mockImplementation((cmd: string) =>
      cmd === 'fetch_and_parse_epg' ? new Promise((r) => { finish = r; }) : Promise.resolve());
    const run = syncEpg();
    await vi.advanceTimersByTimeAsync(0);
    requestSyncAbort();
    cancelAbort();
    expect(h.invoke).toHaveBeenCalledWith('cancel_epg_abort');
    finish({ programs_count: 5, channels_count: 2, duration_ms: 9 });
    expect((await run).programsCount).toBe(5);
  });

  it('requestSyncAbort ne fait rien quand aucune synchro n\'est en cours', () => {
    requestSyncAbort();
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it('waitForSyncEnd se termine même si la synchro a échoué', async () => {
    h.invoke.mockRejectedValueOnce(new Error('KO'));
    const run = syncEpg().catch(() => {});
    await expect(waitForSyncEnd()).resolves.toBeUndefined();
    await run;
  });
});

describe('checkAndAutoSync', () => {
  /** Programme les valeurs de `meta` et de la table epg_programs lues au lancement. */
  function seed(opts: { status?: string; resync?: string; maxStop?: number | null }) {
    h.db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("key = 'epg_sync_status'")) return opts.status ? [{ value: opts.status }] : [];
      if (sql.includes("key = 'epg_needs_resync'")) return opts.resync ? [{ value: opts.resync }] : [];
      if (sql.includes('MAX(stop_ts)')) return [{ max_stop: opts.maxStop ?? null }];
      return [];
    });
  }
  const synced = () => h.invoke.mock.calls.some((c) => c[0] === 'fetch_and_parse_epg');
  const settle = async () => { await vi.advanceTimersByTimeAsync(0); };

  beforeEach(() => {
    h.invoke.mockResolvedValue({ programs_count: 1, channels_count: 1, duration_ms: 1 });
  });

  it('ne fait rien quand le guide est désactivé', async () => {
    h.isEpgEnabled.mockReturnValue(false);
    await checkAndAutoSync();
    expect(h.db.select).not.toHaveBeenCalled();
    expect(synced()).toBe(false);
  });

  it('reporte la synchro sur une connexion limitée en mode Wi-Fi uniquement', async () => {
    h.isEpgWifiOnly.mockReturnValue(true);
    h.getNetworkStatus.mockResolvedValue({ metered: true, type: 'cellular' });
    seed({ status: 'complete', maxStop: null });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(false);
    expect(h.db.select).not.toHaveBeenCalled();
  });

  it('synchronise en Wi-Fi uniquement quand la connexion n\'est pas limitée', async () => {
    h.isEpgWifiOnly.mockReturnValue(true);
    seed({ status: 'complete', maxStop: null });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(true);
  });

  it('synchronise quand le guide est vide', async () => {
    seed({ status: 'complete', maxStop: null });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(true);
  });

  it('synchronise quand le guide couvre moins de 2 jours', async () => {
    seed({ status: 'complete', maxStop: NOW + 86400 });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(true);
  });

  it('ne synchronise pas quand le guide couvre plus de 2 jours', async () => {
    seed({ status: 'complete', maxStop: NOW + 3 * 86400 });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(false);
  });

  it('resynchronise quand le drapeau de nouvelles chaînes est levé, même si le guide est frais', async () => {
    seed({ status: 'complete', resync: '1', maxStop: NOW + 10 * 86400 });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(true);
  });

  it('reste en pause tant que la date de reprise n\'est pas passée', async () => {
    h.db.select.mockImplementation(async (sql: string) => {
      if (sql.includes("key = 'epg_sync_status'")) return [{ value: 'paused' }];
      if (sql.includes("key = 'epg_auto_sync_paused_until'")) return [{ value: String(NOW_MS + 1000) }];
      return [];
    });
    await checkAndAutoSync();
    await settle();
    expect(synced()).toBe(false);
    expect(h.setMeta).not.toHaveBeenCalled();
  });

  it('ne lève pas d\'erreur si la base échoue', async () => {
    h.db.select.mockRejectedValue(new Error('no such table'));
    await expect(checkAndAutoSync()).resolves.toBeUndefined();
    expect(synced()).toBe(false);
  });
});
