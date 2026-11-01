/**
 * Envois vers le cloud sortis de syncPush.ts dans push/ : les parties que les autres
 * tests ne couvraient pas (préférences, ajout d'une catégorie masquée, envoi groupé des catégories
 * masquées : nouvel essai, abandon sans retrait, tout démasqué, orphelins sur plusieurs pages).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { table: string; op: string; args: unknown[]; filters: [string, unknown][]; range?: [number, number] };
type Result = { data?: unknown; error: { message: string; code?: string } | null };

const calls: Call[] = [];
let respond: (call: Call) => Result = () => ({ error: null });

/** Requête Supabase simulée : note chaque appel et répond par `respond` */
function builder(table: string) {
  const call: Call = { table, op: '', args: [], filters: [] };
  const b = {
    upsert: (...args: unknown[]) => { call.op = 'upsert'; call.args = args; return b; },
    delete: () => { call.op = 'delete'; return b; },
    select: (...args: unknown[]) => { call.op = 'select'; call.args = args; return b; },
    eq: (col: string, val: unknown) => { call.filters.push([col, val]); return b; },
    in: (col: string, val: unknown) => { call.filters.push([col, val]); return b; },
    range: (from: number, to: number) => { call.range = [from, to]; return b; },
    then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve(respond(call)).then(resolve, reject);
    },
  };
  return b;
}

vi.mock('../../supabaseClient', () => ({ supabase: { from: (table: string) => builder(table) } }));
vi.mock('../../../utils/devLog', () => ({ devLog: vi.fn() }));
const updateBaseline = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../syncBaseline', () => ({
  currentGeneration: () => 7,
  updateBaseline: (...args: unknown[]) => updateBaseline(...args),
}));

import { setCurrentSyncUserId } from '../syncState';
import {
  pushPreferenceToCloud, pushHiddenCategoryToCloud, batchSyncHiddenCategoriesToCloud,
  pushPlaybackDeleteToCloud, pushLiveTvBookmarkUpsertToCloud, pushWatchlistDeleteToCloud, pushHiddenCategoryDeleteToCloud,
  pushPlaybackUpsertToCloud,
} from '../syncPush';
import { hasCloudRefusal, clearCloudRefusal } from '../cloudRefusal';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  calls.length = 0;
  updateBaseline.mockClear();
  respond = () => ({ error: null });
  setCurrentSyncUserId('u1');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('pushPreferenceToCloud', () => {
  it('envoie la préférence du compte connecté, avec sa date', async () => {
    pushPreferenceToCloud('lang', 'fr');
    await flush();
    expect(calls).toHaveLength(1);
    const [row, options] = calls[0].args as [Record<string, unknown>, unknown];
    expect(calls[0].table).toBe('user_preferences');
    expect(row).toMatchObject({ user_id: 'u1', key: 'lang', value: 'fr' });
    expect(typeof row.updated_at).toBe('string');
    expect(options).toEqual({ onConflict: 'user_id,key' });
  });

  it("n'envoie rien sans compte connecté", async () => {
    setCurrentSyncUserId(null);
    pushPreferenceToCloud('lang', 'fr');
    await flush();
    expect(calls).toHaveLength(0);
  });
});

describe('pushHiddenCategoryToCloud', () => {
  it('ajoute la catégorie au dernier accord seulement si l’envoi réussit', async () => {
    pushHiddenCategoryToCloud('12', 'live');
    await flush();
    expect(calls[0]).toMatchObject({ table: 'user_hidden_categories', op: 'upsert' });
    expect(updateBaseline).toHaveBeenCalledWith('u1', 'hidden', { set: [['12::live', 0]], generation: 7 });

    updateBaseline.mockClear();
    respond = () => ({ error: { message: 'offline' } });
    pushHiddenCategoryToCloud('13', 'live');
    await flush();
    expect(updateBaseline).not.toHaveBeenCalled();
  });
});

describe('batchSyncHiddenCategoriesToCloud', () => {
  it('sans compte connecté : rien n’est envoyé et ce n’est pas une erreur', async () => {
    setCurrentSyncUserId(null);
    expect(await batchSyncHiddenCategoriesToCloud('live', ['1'])).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('envoie par paquets de 200 et retente une fois un paquet refusé', async () => {
    let failures = 1;
    respond = (call) => {
      if (call.op === 'upsert' && failures > 0) { failures--; return { error: { message: 'timeout' } }; }
      if (call.op === 'select') return { data: [], error: null };
      return { error: null };
    };
    const ids = Array.from({ length: 450 }, (_, i) => String(i));
    expect(await batchSyncHiddenCategoriesToCloud('movie', ids)).toBe(true);
    const upserts = calls.filter((c) => c.op === 'upsert');
    expect(upserts.map((c) => (c.args[0] as unknown[]).length)).toEqual([200, 200, 200, 50]);
  });

  it('un paquet refusé deux fois : abandon sans rien retirer du cloud', async () => {
    respond = (call) => (call.op === 'upsert' ? { error: { message: 'down' } } : { error: null });
    expect(await batchSyncHiddenCategoriesToCloud('movie', ['1', '2'])).toBe(false);
    expect(calls.filter((c) => c.op === 'delete')).toHaveLength(0);
    expect(updateBaseline).not.toHaveBeenCalled();
  });

  it('tout démasqué : retire toutes les catégories de ce type, et du dernier accord', async () => {
    expect(await batchSyncHiddenCategoriesToCloud('series', [])).toBe(true);
    const del = calls.find((c) => c.op === 'delete');
    expect(del?.filters).toEqual([['user_id', 'u1'], ['category_type', 'series']]);
    const removeWhere = (updateBaseline.mock.calls[updateBaseline.mock.calls.length - 1][2] as { removeWhere: (k: string) => boolean }).removeWhere;
    expect(removeWhere('4::series')).toBe(true);
    expect(removeWhere('4::movie')).toBe(false);
  });

  it('lit le cloud sur plusieurs pages et ne retire que les catégories qui ne sont plus masquées', async () => {
    const cloud = Array.from({ length: 1500 }, (_, i) => ({ category_id: String(i) }));
    respond = (call) => {
      if (call.op === 'select' && call.range) return { data: cloud.slice(call.range[0], call.range[1] + 1), error: null };
      return { error: null };
    };
    const desired = Array.from({ length: 1499 }, (_, i) => String(i));
    expect(await batchSyncHiddenCategoriesToCloud('live', desired)).toBe(true);
    expect(calls.filter((c) => c.op === 'select').map((c) => c.range)).toEqual([[0, 999], [1000, 1999]]);
    const deletes = calls.filter((c) => c.op === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toContainEqual(['category_id', ['1499']]);
    expect(updateBaseline).toHaveBeenLastCalledWith('u1', 'hidden', { remove: ['1499::live'], generation: 7 });
  });

  it('un retrait d’orphelins raté les laisse dans le dernier accord', async () => {
    respond = (call) => {
      if (call.op === 'select') return { data: [{ category_id: '1' }, { category_id: '9' }], error: null };
      if (call.op === 'delete') return { error: { message: 'denied' } };
      return { error: null };
    };
    expect(await batchSyncHiddenCategoriesToCloud('live', ['1'])).toBe(true);
    expect(updateBaseline).toHaveBeenCalledTimes(1);
    expect(updateBaseline.mock.calls[0][2]).toMatchObject({ set: [['1::live', 0]] });
  });
});

describe('envois sans attente : refus et échecs traités', () => {
  /** Promesses rejetées que personne ne traite pendant le test */
  function watchUnhandled() {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    return { unhandled, stop: () => process.off('unhandledRejection', onUnhandled) };
  }
  const settle = async () => { await flush(); await flush(); };

  it('requête rejetée (réseau, client) : avertissement, pas de promesse rejetée non traitée', async () => {
    const watch = watchUnhandled();
    vi.mocked(console.warn).mockClear();
    respond = () => { throw new Error('Failed to fetch'); };
    pushPreferenceToCloud('lang', 'fr');
    pushPlaybackDeleteToCloud(12);
    pushLiveTvBookmarkUpsertToCloud('favorite', '5');
    pushWatchlistDeleteToCloud(3, 'movie', 603);
    pushHiddenCategoryDeleteToCloud('9', 'movie');
    await settle();
    watch.stop();

    expect(watch.unhandled).toEqual([]);
    expect(updateBaseline).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(5);
  });

  it("mise à jour du dernier accord en échec après l'envoi (base fermée) : traitée aussi", async () => {
    const watch = watchUnhandled();
    updateBaseline.mockRejectedValueOnce(new Error('database closed'));
    pushPlaybackDeleteToCloud(12);
    await settle();
    watch.stop();

    expect(watch.unhandled).toEqual([]);
    expect(updateBaseline).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('playback delete'), expect.anything());
  });

  it('refus du cloud : avertissement, dernier accord inchangé', async () => {
    respond = () => ({ error: { message: 'permission denied' } });
    pushPlaybackDeleteToCloud(12);
    await settle();
    expect(updateBaseline).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('playback delete'), 'permission denied');
  });
});

// Un numéro du fournisseur démesuré ne part pas (la base le refuserait et
// bloquerait tout l'envoi) ; un refus de la base pour une borne dépassée est signalé à l'écran.
describe('numéros du fournisseur trop longs et refus de la base', () => {
  const HUGE = 'x'.repeat(129);
  beforeEach(() => clearCloudRefusal());

  it('catégorie masquée ou épinglée démesurée : rien n’est envoyé', async () => {
    pushHiddenCategoryToCloud(HUGE, 'live');
    pushLiveTvBookmarkUpsertToCloud('pinned_category', HUGE);
    await flush();
    expect(calls).toHaveLength(0);
    expect(updateBaseline).not.toHaveBeenCalled();
  });

  it('reprise : un numéro d’épisode suivant démesuré part vide', async () => {
    pushPlaybackUpsertToCloud(1, 'episode', { title: 'T', next_episode_id: HUGE, time_seconds: 1, duration_seconds: 2 });
    await flush();
    expect((calls[0].args[0] as Record<string, unknown>).next_episode_id).toBeNull();
  });

  it('envoi groupé : la catégorie démesurée reste sur l’appareil, les autres partent', async () => {
    respond = (call) => (call.op === 'select' ? { data: [], error: null } : { error: null });
    expect(await batchSyncHiddenCategoriesToCloud('live', ['1', HUGE])).toBe(true);
    const upsert = calls.find((c) => c.op === 'upsert')!;
    expect((upsert.args[0] as { category_id: string }[]).map((r) => r.category_id)).toEqual(['1']);
    expect(updateBaseline).toHaveBeenCalledWith('u1', 'hidden', expect.objectContaining({ set: [['1::live', 0]] }));
  });

  it('borne dépassée (23514) : le refus est noté pour l’écran ; une autre erreur ne l’est pas', async () => {
    respond = () => ({ error: { message: 'other', code: '57014' } });
    pushHiddenCategoryToCloud('1', 'live');
    await flush();
    expect(hasCloudRefusal()).toBe(false);
    respond = () => ({ error: { message: 'violates check constraint', code: '23514' } });
    pushHiddenCategoryToCloud('1', 'live');
    await flush();
    expect(hasCloudRefusal()).toBe(true);
  });

  it('envoi groupé refusé pour une borne : noté aussi', async () => {
    respond = () => ({ error: { message: 'nyx_plafond_lignes', code: '23514' } });
    expect(await batchSyncHiddenCategoriesToCloud('live', ['1'])).toBe(false);
    expect(hasCloudRefusal()).toBe(true);
  });
});

