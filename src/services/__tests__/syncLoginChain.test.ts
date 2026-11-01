/**
 * Enchaînement réel du démarrage : syncOnLogin rend la main avant la fin de la synchro des
 * favoris TV et des reprises (lancées sans être attendues), puis la session re-lie Ma liste et
 * démarre les relances (useSessionLifecycle). Ces deux étapes ne doivent pas arrêter la synchro
 * encore en cours : un favori ajouté ou une reprise retirée sur un autre appareil n'arrivait qu'à la
 * synchro régulière, 15 minutes plus tard.
 *
 * Seuls la base locale et Supabase sont simulés ; syncService, syncBaseline et syncScheduler sont
 * les vrais. Les lectures du cloud des favoris TV et des reprises attendent qu'on les libère, comme
 * une vraie requête réseau.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any -- fausses base et Supabase : lignes et réponses de forme libre */
const meta = new Map<string, string>();
const tables: Record<string, any[]> = {};
const mockExecute = vi.fn(async (..._args: any[]) => ({ rowsAffected: 0 }));

vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(async () => ({
    select: async (sql: string) => {
      const table = /FROM (\w+)/.exec(sql)?.[1] ?? '';
      return tables[table] ?? [];
    },
    execute: (...args: any[]) => mockExecute(...args),
  })),
  getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
  setMeta: vi.fn(async (key: string, value: string) => { meta.set(key, value); }),
  isDatabaseOf: vi.fn(() => true),
}));

/** Lignes du cloud par table, et tables dont la lecture attend d'être libérée */
const cloud: Record<string, any[]> = {};
const gated = new Set<string>();
let openGates: () => void = () => {};
let gatesOpen = Promise.resolve();

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const chain: any = {
          eq: () => chain,
          order: () => chain,
          range: async () => {
            if (gated.has(table)) await gatesOpen;
            return { data: cloud[table] ?? [], error: null };
          },
        };
        return chain;
      },
      upsert: async () => ({ error: null }),
      delete: () => {
        const chain: any = { eq: () => chain, then: (cb: any) => cb({ error: null }) };
        return chain;
      },
    }),
  },
}));

vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { syncOnLogin, setCurrentSyncUserId } from '../syncService';
import { startCloudResync, stopCloudResync } from '../sync/syncScheduler';
import { forgetForCurrentAccount } from '../sync/syncBaseline';

const USER = 'user-1';

/** Démarrage tel que useSessionLifecycle le fait (reprise de session comme connexion) */
async function bootSession(): Promise<void> {
  setCurrentSyncUserId(USER);
  await syncOnLogin(USER);
  // Re-liaison de Ma liste : un titre qui n'est plus chez le fournisseur est oublié du dernier accord
  await forgetForCurrentAccount('watchlist', ['t:1:movie']);
  startCloudResync(USER);
}

function executedWith(fragment: string): any[][] {
  return mockExecute.mock.calls.filter(([sql]) => typeof sql === 'string' && sql.includes(fragment));
}

describe('synchro au démarrage : favoris TV et reprises', () => {
  beforeEach(() => {
    meta.clear();
    for (const key of Object.keys(tables)) delete tables[key];
    for (const key of Object.keys(cloud)) delete cloud[key];
    mockExecute.mockClear();
    gated.clear();
    gated.add('user_livetv_bookmarks');
    gated.add('user_playback_progress');
    gatesOpen = new Promise<void>((resolve) => { openGates = resolve; });
  });

  afterEach(() => {
    openGates();
    stopCloudResync();
    setCurrentSyncUserId(null);
  });

  it('une chaîne et une catégorie mises en favori sur un autre appareil arrivent au démarrage', async () => {
    cloud.user_livetv_bookmarks = [
      { user_id: USER, bookmark_type: 'favorite', item_id: '42' },
      { user_id: USER, bookmark_type: 'pinned_category', item_id: '7' },
    ];

    await bootSession();
    openGates();

    await vi.waitFor(() => {
      expect(executedWith('INSERT OR IGNORE INTO live_tv_favorites')).toEqual([[expect.any(String), [42, expect.any(Number)]]]);
      expect(executedWith('INSERT OR IGNORE INTO live_tv_pinned_categories')).toEqual([[expect.any(String), ['7', expect.any(Number)]]]);
    });
    // Le dernier accord retient les deux : un retrait ailleurs pourra se propager ensuite
    await vi.waitFor(() => {
      expect(JSON.parse(meta.get('sync_baseline:livetv') ?? '{}')).toEqual({ 'favorite::42': 0, 'pinned_category::7': 0 });
    });
  });

  it('une reprise retirée sur un autre appareil disparaît au démarrage', async () => {
    // Les deux appareils étaient d'accord sur cette reprise ; l'autre l'a retirée du cloud
    meta.set('sync_baseline:playback', JSON.stringify({ 7: 1000 }));
    tables.playback_progress = [{ stream_id: 7, content_type: 'movie', title: 'Film', updated_at: 1000 }];
    cloud.user_playback_progress = [];

    await bootSession();
    openGates();

    await vi.waitFor(() => {
      expect(executedWith('DELETE FROM playback_progress WHERE stream_id')).toEqual([[expect.any(String), [7]]]);
    });
  });

  it("une déconnexion pendant la synchro l'arrête avant toute écriture, et le dit dans le journal", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cloud.user_livetv_bookmarks = [{ user_id: USER, bookmark_type: 'favorite', item_id: '42' }];

    await bootSession();
    stopCloudResync();
    setCurrentSyncUserId(null);
    openGates();

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('livetv: stopped before writing'));
    });
    expect(executedWith('live_tv_favorites')).toEqual([]);
    warn.mockRestore();
  });

  it('une reprise oubliée pendant la synchro des reprises arrête toujours celle-ci (garde-fou conservé)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cloud.user_playback_progress = [
      { user_id: USER, stream_id: 9, content_type: 'movie', title: 'Film', updated_at: new Date(5000).toISOString() },
    ];

    await bootSession();
    await forgetForCurrentAccount('playback', ['9']);
    openGates();

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('playback: stopped before writing'));
    });
    expect(executedWith('INSERT INTO playback_progress')).toEqual([]);
    warn.mockRestore();
  });
});
