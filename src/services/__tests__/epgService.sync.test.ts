/**
 * epgService — synchro du guide et changement de session.
 *
 * Une synchro qui déborde sur une déconnexion ou un changement de compte ne doit ni purger le guide,
 * ni écrire dans la base du compte suivant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let pendingInvoke: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
const invokeCalls: string[] = [];
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    invokeCalls.push(cmd);
    if (cmd !== 'fetch_and_parse_epg') return Promise.resolve();
    return new Promise((resolve, reject) => { pendingInvoke = { resolve, reject }; });
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

let dbFileName: string | null = 'nyxplayer_a.db';
let syncStatus: string | null = null;
const executed: string[] = [];
const metaWrites: [string, string][] = [];
/** Autres clés de `meta` (compteur d'interruptions, pause), lues et écrites par l'app. */
const meta: Record<string, string> = {};
vi.mock('../dbCore', () => ({
  getDatabaseFileName: () => dbFileName,
  getDatabase: async () => ({
    execute: async (sql: string) => { executed.push(sql); },
    select: async (sql: string) => {
      if (sql.includes('epg_sync_status')) return syncStatus ? [{ value: syncStatus }] : [];
      if (sql.includes('epg_needs_resync')) return [];
      const key = /key = '(\w+)'/.exec(sql)?.[1];
      if (key && key in meta) return [{ value: meta[key] }];
      if (sql.includes('MAX(stop_ts)')) return [{ max_stop: Math.floor(Date.now() / 1000) + 10 * 86400 }];
      return [];
    },
  }),
  refreshConnection: async () => {},
  setMeta: async (key: string, value: string) => {
    metaWrites.push([key, value]);
    if (key === 'epg_sync_status') syncStatus = value;
    else meta[key] = value;
  },
}));
vi.mock('../preferencesService', () => ({
  getDnsProvider: () => 'system',
  isEpgEnabled: () => true,
  isEpgWifiOnly: () => false,
}));
vi.mock('../networkStatus', () => ({ getNetworkStatus: async () => ({ metered: false, type: 'wifi' }) }));

import {
  syncEpg, stopSyncForSessionChange, requestSyncAbort, checkAndAutoSync, isSyncing,
  MAX_INTERRUPTED_SYNCS, AUTO_SYNC_PAUSE_MS,
} from '../epgService';

const purged = () => executed.some((sql) => sql.includes('DELETE FROM epg_programs'));
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Lance une synchro et attend qu'elle soit chez le Rust (objet : une promesse serait aplatie). */
async function startSync(): Promise<{ run: Promise<unknown> }> {
  const run = syncEpg().catch((e: unknown) => e);
  await flush();
  expect(pendingInvoke).not.toBeNull();
  return { run };
}

beforeEach(() => {
  pendingInvoke = null;
  invokeCalls.length = 0;
  executed.length = 0;
  metaWrites.length = 0;
  dbFileName = 'nyxplayer_a.db';
  syncStatus = null;
  for (const key of Object.keys(meta)) delete meta[key];
});

describe('epgService — synchro et changement de session', () => {
  it('déconnexion pendant la synchro : arrêt demandé au Rust, guide gardé, aucun état écrit', async () => {
    const { run } = await startSync();
    stopSyncForSessionChange();
    expect(invokeCalls).toContain('abort_epg_sync');
    pendingInvoke!.reject('EPG sync aborted by user');
    await run;
    expect(purged()).toBe(false);
    expect(metaWrites).toEqual([['epg_sync_status', 'syncing']]);
    expect(isSyncing()).toBe(false);
  });

  it('déconnexion juste après le lancement : le Rust n\'est pas appelé', async () => {
    const run = syncEpg().catch((e: unknown) => e);
    stopSyncForSessionChange();
    await run;
    expect(invokeCalls).not.toContain('fetch_and_parse_epg');
    expect(purged()).toBe(false);
  });

  it('autre compte ouvert quand la synchro finit : rien n\'est écrit dans sa base', async () => {
    const { run } = await startSync();
    dbFileName = 'nyxplayer_b.db';
    pendingInvoke!.resolve({ programs_count: 10, channels_count: 1, duration_ms: 5, filtered_out: 0 });
    await run;
    expect(metaWrites).toEqual([['epg_sync_status', 'syncing']]);
    expect(purged()).toBe(false);
  });

  it('guide désactivé pendant la synchro : l\'arrêt demandé par l\'utilisateur purge toujours', async () => {
    const { run } = await startSync();
    requestSyncAbort();
    pendingInvoke!.reject('EPG sync aborted by user');
    await run;
    expect(purged()).toBe(true);
  });

  it('reprise après une synchro interrompue : attend la fin de la synchro en cours, relance sans purger', async () => {
    const { run: first } = await startSync();
    syncStatus = 'syncing';
    const check = checkAndAutoSync();
    await flush();
    // La synchro en cours n'est pas doublée ni purgée tant qu'elle tourne
    expect(invokeCalls.filter((c) => c === 'fetch_and_parse_epg')).toHaveLength(1);
    stopSyncForSessionChange();
    pendingInvoke!.reject('EPG sync aborted by user');
    await first;
    await check;
    await flush();
    expect(purged()).toBe(false);
    expect(invokeCalls.filter((c) => c === 'fetch_and_parse_epg')).toHaveLength(2);
    pendingInvoke!.resolve({ programs_count: 10, channels_count: 1, duration_ms: 5, filtered_out: 0 });
    await flush();
    // « complete » et la date sont écrits par le Rust avec le guide, plus par l'app
    expect(metaWrites.map(([k, v]) => `${k}=${v}`))
      .toEqual(['epg_sync_status=syncing', 'epg_sync_interrupted=1', 'epg_sync_status=syncing']);
    expect(isSyncing()).toBe(false);
  });
});

describe('epgService — synchro du guide qui fait tomber l\'app à chaque lancement', () => {
  const syncsStarted = () => invokeCalls.filter((c) => c === 'fetch_and_parse_epg').length;

  /** Lancement de l'app après une synchro jamais revenue du Rust (app tombée pendant la synchro). */
  async function launchAfterCrash(): Promise<void> {
    syncStatus = 'syncing';
    pendingInvoke = null;
    await checkAndAutoSync();
    await flush();
  }

  it('une ou deux interruptions : la synchro reprend au lancement, comme avant', async () => {
    await launchAfterCrash();
    expect(syncsStarted()).toBe(1);
    pendingInvoke!.reject(new Error('stop'));
    await flush();
    // Retombée : on simule l'app tuée, la synchro relancée n'est jamais revenue
    meta.epg_sync_interrupted = '1';
    await launchAfterCrash();
    expect(syncsStarted()).toBe(2);
    expect(meta.epg_sync_interrupted).toBe('2');
    pendingInvoke!.reject(new Error('stop'));
    await flush();
  });

  it(`${MAX_INTERRUPTED_SYNCS} interruptions de suite : plus de relance, synchro automatique en pause`, async () => {
    meta.epg_sync_interrupted = String(MAX_INTERRUPTED_SYNCS - 1);
    const before = Date.now();
    await launchAfterCrash();
    expect(syncsStarted()).toBe(0);
    expect(syncStatus).toBe('paused');
    expect(Number(meta.epg_auto_sync_paused_until)).toBeGreaterThanOrEqual(before + AUTO_SYNC_PAUSE_MS);

    // Lancements suivants pendant la pause : rien ne part, même avec un guide périmé
    await checkAndAutoSync();
    await flush();
    expect(syncsStarted()).toBe(0);
  });

  it('fin de la pause : une seule nouvelle interruption suffit à la reprendre', async () => {
    meta.epg_sync_interrupted = String(MAX_INTERRUPTED_SYNCS);
    meta.epg_auto_sync_paused_until = String(Date.now() - 1);
    syncStatus = 'paused';
    await launchAfterCrash();
    expect(syncsStarted()).toBe(0);
    expect(syncStatus).toBe('paused');
    expect(Number(meta.epg_auto_sync_paused_until)).toBeGreaterThan(Date.now());
  });

  it('une synchro allée au bout remet le compteur à zéro', async () => {
    meta.epg_sync_interrupted = '2';
    syncStatus = 'complete';
    meta.epg_auto_sync_paused_until = String(Date.now() + AUTO_SYNC_PAUSE_MS);
    await checkAndAutoSync();
    await flush();
    expect(meta.epg_sync_interrupted).toBe('0');
  });
});
