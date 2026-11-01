/**
 * Dernier accord avec le cloud (sync/syncBaseline.ts) : suppressions qui ne reviennent plus
 * et envois ratés rattrapés pour les reprises de lecture, les favoris et
 * catégories épinglées de la TV en direct et les catégories masquées.
 *
 * Le cloud est une petite table en mémoire par table Supabase ; chaque appareil a sa base locale
 * (tables SQLite simulées et table meta).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// FAUX CLOUD (plusieurs tables)
// ============================================================================

type Row = Record<string, unknown>;
let cloud: Record<string, Row[]> = {};
let networkDown = false;
/** Appelé une fois, pendant la prochaine lecture du cloud (réponse déjà partie) */
let duringCloudRead: (() => Promise<void>) | null = null;

interface Call { table: string; op: string; payload?: unknown; eq: [string, unknown][]; inList?: [string, unknown[]]; range?: [number, number] }

function run(call: Call): { data?: unknown; error: { message: string } | null } {
    if (networkDown) return { error: { message: 'TypeError: Failed to fetch' } };
    const rows = (cloud[call.table] ??= []);
    const match = (row: Row) =>
        call.eq.every(([k, v]) => row[k] === v) && (!call.inList || call.inList[1].includes(row[call.inList[0]]));
    if (call.op === 'select') {
        let data = rows.filter(match).map((row) => ({ ...row }));
        // Comme PostgREST : jamais plus de 1000 lignes par réponse
        data = call.range ? data.slice(call.range[0], Math.min(call.range[1] + 1, call.range[0] + 1000)) : data.slice(0, 1000);
        return { data, error: null };
    }
    if (call.op === 'delete') {
        cloud[call.table] = rows.filter((row) => !match(row));
        return { error: null };
    }
    if (call.op === 'upsert') {
        const keys: Record<string, string[]> = {
            user_livetv_bookmarks: ['user_id', 'bookmark_type', 'item_id'],
            user_hidden_categories: ['user_id', 'category_id', 'category_type'],
            user_playback_progress: ['user_id', 'stream_id'],
        };
        for (const item of (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[]) {
            const existing = rows.find((row) => keys[call.table].every((k) => row[k] === item[k]));
            if (existing) Object.assign(existing, item);
            else rows.push({ ...item });
        }
        return { error: null };
    }
    throw new Error(`faux cloud : ${call.op}`);
}

vi.mock('../supabaseClient', () => ({
    supabase: {
        from: (table: string) => {
            const call: Call = { table, op: '', eq: [] };
            const builder = {
                select: () => { call.op ||= 'select'; return builder; },
                delete: () => { call.op = 'delete'; return builder; },
                upsert: (payload: unknown) => { call.op = 'upsert'; call.payload = payload; return builder; },
                eq: (k: string, v: unknown) => { call.eq.push([k, v]); return builder; },
                in: (k: string, v: unknown[]) => { call.inList = [k, v]; return builder; },
                range: (a: number, b: number) => { call.range = [a, b]; return builder; },
                order: () => builder,
                then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                    Promise.resolve().then(async () => {
                        const response = run(call);
                        // Ce qui se passe sur l'appareil pendant que la réponse du cloud voyage
                        if (call.op === 'select' && duringCloudRead) {
                            const hook = duringCloudRead;
                            duringCloudRead = null;
                            await hook();
                        }
                        return response;
                    }).then(resolve, reject),
            };
            return builder;
        },
    },
}));

// ============================================================================
// FAUSSE BASE LOCALE (un appareil)
// ============================================================================

interface Device {
    favorites: Set<number>;
    pins: Set<string>;
    hidden: Set<string>; // `${category_id}::${type}`
    playback: Map<number, Row>;
    /** Titres officiels du cache TMDB (`tmdb_details_cache`), par `type:tmdb_id` */
    tmdbTitles: Map<string, string>;
    meta: Map<string, string>;
}

function device(): Device {
    return { favorites: new Set(), pins: new Set(), hidden: new Set(), playback: new Map(), tmdbTitles: new Map(), meta: new Map() };
}

let current: Device = device();

const PLAYBACK_COLUMNS = [
    'content_type', 'stream_id', 'tmdb_id', 'title', 'poster_url', 'series_id', 'season_number', 'episode_number',
    'next_episode_id', 'next_season', 'next_episode_number', 'time_seconds', 'duration_seconds', 'container_extension', 'updated_at',
];

const fakeDb = {
    async select<T>(sql: string): Promise<T> {
        if (sql.includes('FROM live_tv_favorites')) return [...current.favorites].map((stream_id) => ({ stream_id })) as T;
        if (sql.includes('FROM live_tv_pinned_categories')) return [...current.pins].map((category_id) => ({ category_id })) as T;
        if (sql.includes('FROM hidden_categories')) {
            return [...current.hidden].map((key) => {
                const [category_id, type] = key.split('::');
                return { category_id, type };
            }) as T;
        }
        if (sql.includes('FROM tmdb_details_cache')) {
            return [...current.tmdbTitles].map(([key, display_name]) => {
                const [type, tmdb_id] = key.split(':');
                return { tmdb_id: Number(tmdb_id), type, display_name };
            }) as T;
        }
        if (sql.includes('FROM playback_progress')) return [...current.playback.values()].map((row) => ({ ...row })) as T;
        throw new Error(`fausse base : ${sql}`);
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
        const text = sql.replace(/\s+/g, ' ').trim();
        if (text.startsWith('INSERT OR IGNORE INTO live_tv_favorites')) current.favorites.add(params[0] as number);
        else if (text.startsWith('INSERT OR IGNORE INTO live_tv_pinned_categories')) current.pins.add(params[0] as string);
        else if (text.startsWith('DELETE FROM live_tv_favorites WHERE stream_id = ?')) current.favorites.delete(params[0] as number);
        else if (text.startsWith('DELETE FROM live_tv_pinned_categories WHERE category_id = ?')) current.pins.delete(params[0] as string);
        else if (text.startsWith('INSERT OR IGNORE INTO hidden_categories')) current.hidden.add(`${params[0]}::${params[1]}`);
        else if (text.startsWith('DELETE FROM hidden_categories WHERE category_id = ? AND type = ?')) current.hidden.delete(`${params[0]}::${params[1]}`);
        else if (text.startsWith('INSERT INTO playback_progress')) {
            const row = Object.fromEntries(PLAYBACK_COLUMNS.map((col, i) => [col, params[i]]));
            current.playback.set(row.stream_id as number, row);
        } else if (text.startsWith('DELETE FROM playback_progress WHERE stream_id = ?')) current.playback.delete(params[0] as number);
        else throw new Error(`fausse base : ${text}`);
        return { rowsAffected: 1 };
    },
};

let databaseIsOurs = true;
vi.mock('../dbCore', () => ({
    getDatabase: vi.fn(async () => fakeDb),
    getMeta: vi.fn(async (key: string) => current.meta.get(key) ?? null),
    setMeta: vi.fn(async (key: string, value: string) => { current.meta.set(key, value); }),
    isDatabaseOf: vi.fn(() => databaseIsOurs),
}));
vi.mock('../liveTvBookmarksService', () => ({ reloadLiveTvFromDb: vi.fn(async () => {}) }));
vi.mock('../hiddenCategoriesService', () => ({ reloadHiddenCategoriesFromDb: vi.fn(async () => {}) }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import {
    planMerge, readBaseline, updateBaseline, clearBaselines, canStillWrite, forgetForCurrentAccount, EMPTY_SIDE_REMOVAL_LIMIT,
} from '../sync/syncBaseline';
import { pushLiveTvBookmarkUpsertToCloud } from '../sync/syncPush';
import { syncLiveTv } from '../sync/syncLiveTv';
import { syncHiddenCategories } from '../sync/syncHiddenCategories';
import { syncPlayback } from '../sync/syncPlayback';
import {
    pushLiveTvBookmarkDeleteToCloud, pushHiddenCategoryDeleteToCloud, pushPlaybackDeleteToCloud,
    pushPlaybackUpsertToCloud, batchSyncHiddenCategoriesToCloud,
} from '../sync/syncPush';
import { setCurrentSyncUserId } from '../sync/syncState';
import type { SyncResult } from '../sync/syncTypes';

const USER = 'user-test';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function emptyResult(): SyncResult {
    return {
        preferences: { pulled: 0, pushed: 0 }, watchlist: { pulled: 0, pushed: 0 }, playback: { pulled: 0, pushed: 0 },
        liveTv: { pulled: 0, pushed: 0 }, hiddenCategories: { pulled: 0, pushed: 0 }, errors: [], cloudWatchlistItems: [],
    };
}

async function on(d: Device, task: () => Promise<unknown>) {
    current = d;
    await task();
    await flush();
}

beforeEach(() => {
    cloud = {};
    networkDown = false;
    duringCloudRead = null;
    databaseIsOurs = true;
    current = device();
    setCurrentSyncUserId(USER);
});

// ============================================================================
// PLAN DE FUSION
// ============================================================================

describe('planMerge', () => {
    const set = (...keys: string[]) => new Set(keys);
    const base = (...keys: string[]) => new Map(keys.map((k) => [k, 0]));

    it('keeps the old union rule for items missing from the last agreement', () => {
        const plan = planMerge(set('a', 'b'), set('b', 'c'), base());
        expect(plan).toMatchObject({ pushToCloud: ['a'], pullToLocal: ['c'], inBoth: ['b'], removeLocal: [], removeCloud: [] });
    });

    it('removes here what was removed elsewhere, and from the cloud what was removed here', () => {
        const plan = planMerge(set('a', 'b'), set('b', 'c'), base('a', 'b', 'c', 'd'));
        expect(plan).toMatchObject({ removeLocal: ['a'], removeCloud: ['c'], inBoth: ['b'], stale: ['d'], pushToCloud: [], pullToLocal: [] });
    });

    it('never applies more than the limit of removals against a side that is entirely empty', () => {
        const many = Array.from({ length: EMPTY_SIDE_REMOVAL_LIMIT + 1 }, (_, i) => `k${i}`);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(planMerge(new Set(many), set(), base(...many))).toMatchObject({ removeLocal: [], pushToCloud: many });
        expect(planMerge(set(), new Set(many), base(...many))).toMatchObject({ removeCloud: [], pullToLocal: many });
        warn.mockRestore();
        // Jusqu'à la limite, un côté vide est un vrai retrait (le dernier titre retiré ailleurs)
        expect(planMerge(set('a'), set(), base('a'))).toMatchObject({ removeLocal: ['a'] });
    });

    it('never applies a mass removal to the cloud: more than half of it at once (wiped device, purge)', () => {
        const all = Array.from({ length: 10 }, (_, i) => `k${i}`);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const plan = planMerge(set('k0', 'k1'), new Set(all), base(...all));
        warn.mockRestore();
        expect(plan.removeCloud).toEqual([]);
        expect(plan.pullToLocal).toHaveLength(8);
        // Quelques retraits dans une longue liste restent appliqués
        expect(planMerge(new Set(all.slice(2)), new Set(all), base(...all)).removeCloud).toEqual(['k0', 'k1']);
    });

    it('applies grouped removals made elsewhere as long as the cloud still holds something', () => {
        const all = Array.from({ length: 10 }, (_, i) => `k${i}`);
        const plan = planMerge(new Set(all), set('k0', 'k1'), base(...all));
        expect(plan.removeLocal).toHaveLength(8);
        expect(plan.pushToCloud).toEqual([]);
    });
});

describe('updateBaseline', () => {
    it('keeps every change when several updates overlap', async () => {
        await Promise.all([
            updateBaseline(USER, 'livetv', { set: [['a', 0]] }),
            updateBaseline(USER, 'livetv', { set: [['b', 0]] }),
            updateBaseline(USER, 'livetv', { remove: ['a'] }),
        ]);
        expect([...(await readBaseline(USER, 'livetv')).keys()]).toEqual(['b']);
    });

    it('writes nothing once another account is signed in or owns the open database', async () => {
        setCurrentSyncUserId('autre-compte');
        await updateBaseline(USER, 'livetv', { set: [['a', 0]] });
        setCurrentSyncUserId(USER);
        databaseIsOurs = false;
        await updateBaseline(USER, 'livetv', { set: [['b', 0]] });
        await clearBaselines(USER, ['livetv']);
        expect(current.meta.size).toBe(0);
    });
});

describe('Generation of the last agreement, one per data type', () => {
    it('forgetting a « Ma liste » title does not stop a Live TV sync already running, forgetting a favorite does', async () => {
        const read = await readBaseline(USER, 'livetv');

        // Re-liaison au démarrage : un titre de Ma liste est oublié pendant la synchro des favoris TV
        await forgetForCurrentAccount('watchlist', ['tmdb-1']);
        expect(canStillWrite(USER, read)).toBe(true);
        await updateBaseline(USER, 'livetv', { set: [['favorite:10', 0]], generation: read.generation });
        expect([...(await readBaseline(USER, 'livetv')).keys()]).toEqual(['favorite:10']);

        // Un favori TV oublié pendant cette même synchro l'empêche d'écrire
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await forgetForCurrentAccount('livetv', ['favorite:99']);
        expect(canStillWrite(USER, read)).toBe(false);
        await updateBaseline(USER, 'livetv', { set: [['favorite:20', 0]], generation: read.generation });
        expect([...(await readBaseline(USER, 'livetv')).keys()]).toEqual(['favorite:10']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('livetv'));
        warn.mockRestore();
    });
});

// ============================================================================
// FAVORIS ET CATÉGORIES ÉPINGLÉES (TV EN DIRECT)
// ============================================================================

describe('Live TV bookmarks across devices', () => {
    it('a favorite removed on the phone is not brought back by the TV, which removes it too', async () => {
        const phone = device();
        const tv = device();
        phone.favorites.add(10).add(20);
        phone.pins.add('sport');
        await on(phone, () => syncLiveTv(USER, emptyResult()));
        await on(tv, () => syncLiveTv(USER, emptyResult()));
        expect([...tv.favorites]).toEqual([10, 20]);

        await on(phone, async () => {
            phone.favorites.delete(10);
            phone.pins.delete('sport');
            pushLiveTvBookmarkDeleteToCloud('favorite', '10');
            pushLiveTvBookmarkDeleteToCloud('pinned_category', 'sport');
        });
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        expect([...tv.favorites]).toEqual([20]);
        expect([...tv.pins]).toEqual([]);
        expect(cloud.user_livetv_bookmarks.map((row) => row.item_id)).toEqual(['20']);
    });

    it('a favorite removed offline is removed from the cloud at the next sync', async () => {
        const tv = device();
        tv.favorites.add(10);
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        networkDown = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await on(tv, async () => {
            tv.favorites.delete(10);
            pushLiveTvBookmarkDeleteToCloud('favorite', '10');
        });
        warn.mockRestore();
        networkDown = false;

        await on(tv, () => syncLiveTv(USER, emptyResult()));
        expect(cloud.user_livetv_bookmarks).toEqual([]);
        expect([...tv.favorites]).toEqual([]);
    });
});

// ============================================================================
// CATÉGORIES MASQUÉES
// ============================================================================

describe('Hidden categories across devices', () => {
    it('a category shown again on the PC is shown again on the TV instead of being hidden again everywhere', async () => {
        const pc = device();
        const tv = device();
        pc.hidden.add('1::movie').add('2::movie');
        await on(pc, () => syncHiddenCategories(USER, emptyResult()));
        await on(tv, () => syncHiddenCategories(USER, emptyResult()));
        expect([...tv.hidden]).toEqual(['1::movie', '2::movie']);

        await on(pc, async () => {
            pc.hidden.delete('1::movie');
            pushHiddenCategoryDeleteToCloud('1', 'movie');
        });
        await on(tv, () => syncHiddenCategories(USER, emptyResult()));

        expect([...tv.hidden]).toEqual(['2::movie']);
        expect(cloud.user_hidden_categories.map((row) => row.category_id)).toEqual(['2']);
    });

    it('« Valider » in the category manager records the new state, so a later sync removes nothing else', async () => {
        const tv = device();
        tv.hidden.add('1::live').add('2::live');
        await on(tv, () => syncHiddenCategories(USER, emptyResult()));

        await on(tv, async () => {
            tv.hidden.delete('1::live');
            tv.hidden.add('3::live');
            await batchSyncHiddenCategoriesToCloud('live', ['2', '3']);
        });
        await on(tv, () => syncHiddenCategories(USER, emptyResult()));

        expect([...tv.hidden].sort()).toEqual(['2::live', '3::live']);
        expect(cloud.user_hidden_categories.map((row) => row.category_id).sort()).toEqual(['2', '3']);
    });
});

// ============================================================================
// REPRISES DE LECTURE
// ============================================================================

function progress(stream_id: number, updated_at: number): Row {
    return {
        content_type: 'movie', stream_id, tmdb_id: stream_id, title: `Film ${stream_id}`, poster_url: null,
        series_id: null, season_number: null, episode_number: null, next_episode_id: null, next_season: null,
        next_episode_number: null, time_seconds: 600, duration_seconds: 6000, container_extension: 'mkv', updated_at,
    };
}

describe('Continue watching across devices', () => {
    it('a title removed from « Reprendre » on the PC does not come back from the TV', async () => {
        const pc = device();
        const tv = device();
        pc.playback.set(1, progress(1, 1000)).set(2, progress(2, 2000));
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect([...tv.playback.keys()]).toEqual([1, 2]);

        await on(pc, async () => {
            pc.playback.delete(1);
            pushPlaybackDeleteToCloud(1);
        });
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect([...tv.playback.keys()]).toEqual([2]);
        expect(cloud.user_playback_progress.map((row) => row.stream_id)).toEqual([2]);
    });

    it('clearing « Reprendre » on the PC clears it on the TV too', async () => {
        const pc = device();
        const tv = device();
        for (let id = 1; id <= 8; id++) pc.playback.set(id, progress(id, id * 1000));
        pc.playback.set(9, progress(9, 9000));
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect(tv.playback.size).toBe(9);

        await on(pc, async () => {
            for (let id = 1; id <= 8; id++) {
                pc.playback.delete(id);
                pushPlaybackDeleteToCloud(id);
            }
        });
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect([...tv.playback.keys()]).toEqual([9]);
        expect(cloud.user_playback_progress.map((row) => row.stream_id)).toEqual([9]);
    });

    it('keeps a title watched again here after it was removed elsewhere (the newer action wins)', async () => {
        const pc = device();
        const tv = device();
        pc.playback.set(1, progress(1, 1000));
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));

        await on(pc, async () => {
            pc.playback.delete(1);
            pushPlaybackDeleteToCloud(1);
        });
        tv.playback.set(1, progress(1, 5000)); // regardé de nouveau sur la TV, envoi pas encore parti
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect([...tv.playback.keys()]).toEqual([1]);
        expect(cloud.user_playback_progress.map((row) => row.stream_id)).toEqual([1]);
    });

    it('a removal made offline is removed from the cloud at the next sync', async () => {
        const tv = device();
        tv.playback.set(1, progress(1, 1000));
        await on(tv, () => syncPlayback(USER, emptyResult()));

        networkDown = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await on(tv, async () => {
            tv.playback.delete(1);
            pushPlaybackDeleteToCloud(1);
        });
        warn.mockRestore();
        networkDown = false;

        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect(cloud.user_playback_progress).toEqual([]);
        expect(tv.playback.size).toBe(0);
    });

    it('sync rule behind resume removal: a removal kept in the last agreement leaves the cloud at the next sync', async () => {
        const tv = device();
        tv.playback.set(1, progress(1, 1000)).set(2, progress(2, 2000));
        await on(tv, () => syncPlayback(USER, emptyResult()));

        tv.playback.delete(1); // finalizePlayback : retrait local seulement, gardé dans le dernier accord
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect([...tv.playback.keys()]).toEqual([2]);
        expect(cloud.user_playback_progress.map((row) => row.stream_id)).toEqual([2]);
    });

    it('sync rule behind resume removal: a removal kept in the last agreement loses to a newer progress from another device', async () => {
        const pc = device();
        const tv = device();
        pc.playback.set(1, progress(1, 1000));
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));

        await on(pc, async () => {
            pc.playback.set(1, progress(1, 5000));
            pushPlaybackUpsertToCloud(1, 'movie', { title: 'Film 1', time_seconds: 60, duration_seconds: 600, updated_at: 5000 });
        });
        tv.playback.delete(1); // évincé sur la TV, qui n'a pas encore vu la reprise du PC
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect([...tv.playback.keys()]).toEqual([1]);
        expect(tv.playback.get(1)!.updated_at).toBe(5000);
        expect(cloud.user_playback_progress.map((row) => row.stream_id)).toEqual([1]);
    });

    // Le titre officiel TMDB n'est jamais remplacé par le nom brut
    // du fournisseur venu d'un autre appareil
    const TMDB_POSTER = 'https://image.tmdb.org/t/p/w342/affiche.jpg';
    const RAW_NAME = 'FR| Le.Titre.2020.1080p';

    /** Le PC connaît le film 1 sous son titre TMDB, la TV le reçoit du cloud */
    async function pcAndTvWithTmdbTitle() {
        const pc = device();
        const tv = device();
        pc.playback.set(1, { ...progress(1, 1000), title: 'Le Titre TMDB', poster_url: TMDB_POSTER });
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));
        return { pc, tv };
    }

    it('a newer position from another device keeps the local TMDB title and poster', async () => {
        const { pc, tv } = await pcAndTvWithTmdbTitle();

        // Relancé sur la TV depuis la recherche : pas de titre TMDB, nom brut du fournisseur
        await on(tv, async () => {
            tv.playback.set(1, { ...progress(1, 5000), title: RAW_NAME, poster_url: null });
            pushPlaybackUpsertToCloud(1, 'movie', { title: RAW_NAME, time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)!.updated_at).toBe(5000);
        expect(pc.playback.get(1)!.time_seconds).toBe(900);
        expect(pc.playback.get(1)!.title).toBe('Le Titre TMDB');
        expect(pc.playback.get(1)!.poster_url).toBe(TMDB_POSTER);
        expect(pc.playback.get(1)!.tmdb_id).toBe(1);
    });

    it('a raw provider name sent with the same TMDB number (0.7.6) never replaces the official title known here', async () => {
        const { pc } = await pcAndTvWithTmdbTitle();
        pc.tmdbTitles.set('movie:1', 'Le Titre TMDB');

        // Une version 0.7.6 garde le numéro TMDB mais envoie le nom brut du fournisseur
        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { tmdb_id: 1, title: RAW_NAME, poster_url: TMDB_POSTER, time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)!.time_seconds).toBe(900);
        expect(pc.playback.get(1)!.title).toBe('Le Titre TMDB');
    });

    it('a TMDB title from another device replaces the provider name stored here', async () => {
        const tv = device();
        tv.playback.set(1, { ...progress(1, 1000), title: RAW_NAME });
        tv.tmdbTitles.set('movie:1', 'Le Titre TMDB');
        await on(tv, () => syncPlayback(USER, emptyResult()));

        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { tmdb_id: 1, title: 'Le Titre TMDB', poster_url: TMDB_POSTER, time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect(tv.playback.get(1)!.title).toBe('Le Titre TMDB');
        expect(tv.playback.get(1)!.poster_url).toBe(TMDB_POSTER);
    });

    it('without an official title known here, a title sent with the same TMDB number is taken as is', async () => {
        const { pc } = await pcAndTvWithTmdbTitle();

        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { tmdb_id: 1, title: 'The TMDB Title', time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)!.title).toBe('The TMDB Title');
        // Affiche absente dans la reprise reçue : celle du même titre reste
        expect(pc.playback.get(1)!.poster_url).toBe(TMDB_POSTER);
    });

    it('a number now used by another title (other TMDB number) takes the received title and poster', async () => {
        const { pc } = await pcAndTvWithTmdbTitle();
        pc.tmdbTitles.set('movie:1', 'Le Titre TMDB');

        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { tmdb_id: 2, title: 'Un Autre Film', time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)).toMatchObject({ tmdb_id: 2, title: 'Un Autre Film', poster_url: null });
    });

    it('a number now used by content of another type takes the received row as is', async () => {
        const { pc } = await pcAndTvWithTmdbTitle();

        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'episode', { title: 'FR| Une.Serie.S01E01', series_id: 9, time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)).toMatchObject({ content_type: 'episode', tmdb_id: 0, title: 'FR| Une.Serie.S01E01', poster_url: null });
    });

    it('an empty or « Unknown » title from another device never replaces a real title', async () => {
        const { pc } = await pcAndTvWithTmdbTitle();

        await on(device(), async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { tmdb_id: 1, title: 'Unknown', time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(pc.playback.get(1)).toMatchObject({ time_seconds: 900, title: 'Le Titre TMDB' });
    });

    it('the kept title stays in agreement with the cloud (nothing sent back at the next sync)', async () => {
        const { pc, tv } = await pcAndTvWithTmdbTitle();
        await on(tv, async () => {
            pushPlaybackUpsertToCloud(1, 'movie', { title: RAW_NAME, time_seconds: 900, duration_seconds: 6000, updated_at: 5000 });
        });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        const result = emptyResult();
        await on(pc, () => syncPlayback(USER, result));
        expect(result.playback).toEqual({ pulled: 0, pushed: 0 });
        expect(pc.playback.get(1)!.title).toBe('Le Titre TMDB');
    });

    it('sends the local date of the progress, so an older position never overwrites a newer one', async () => {
        pushPlaybackUpsertToCloud(7, 'movie', { title: 'Film 7', time_seconds: 60, duration_seconds: 600, updated_at: 1234 });
        await flush();
        expect(cloud.user_playback_progress[0].updated_at).toBe(new Date(1234).toISOString());
    });
});

// ============================================================================
// COURSES
// ============================================================================

describe('Races between a sync and what happens meanwhile', () => {
    it('a favorite added while the sync reads the cloud is kept (never taken for a removal elsewhere)', async () => {
        const tv = device();
        tv.favorites.add(10);
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        duringCloudRead = async () => {
            tv.favorites.add(20);
            pushLiveTvBookmarkUpsertToCloud('favorite', '20');
            await flush();
        };
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        expect([...tv.favorites].sort()).toEqual([10, 20]);
        expect(cloud.user_livetv_bookmarks.map((row) => row.item_id).sort()).toEqual(['10', '20']);
    });

    it('a send that lands after local data is wiped does not put its item back in the last agreement', async () => {
        const tv = device();
        current = tv;
        pushLiveTvBookmarkUpsertToCloud('favorite', '30');
        await clearBaselines(USER, ['livetv']); // effacement pendant que l'envoi est en route
        await flush();
        expect(cloud.user_livetv_bookmarks.map((row) => row.item_id)).toEqual(['30']);
        expect(current.meta.get('sync_baseline:livetv')).toBe('{}');
    });

    it('a small list (3 favorites) emptied without the user is refilled from the cloud, never removed from it', async () => {
        const tv = device();
        tv.favorites.add(10).add(20).add(30);
        await on(tv, () => syncLiveTv(USER, emptyResult()));
        expect(cloud.user_livetv_bookmarks).toHaveLength(3);

        // Changement de fournisseur (wipeProviderSpecificData) : table vidée et dernier accord oublié,
        // sans aucun garde-fou des retraits en masse (3 éléments ou moins)
        tv.favorites.clear();
        await clearBaselines(USER, ['livetv']);
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        expect([...tv.favorites].sort()).toEqual([10, 20, 30]);
        expect(cloud.user_livetv_bookmarks).toHaveLength(3);
    });

    it('a sync still running when local data is wiped cannot restore the last agreement and empty the cloud', async () => {
        const tv = device();
        tv.favorites.add(10).add(20);
        await on(tv, () => syncLiveTv(USER, emptyResult()));

        // Pendant la synchro : données locales vidées et dernier accord oublié (nouvelle connexion)
        duringCloudRead = async () => {
            tv.favorites.clear();
            await clearBaselines(USER, ['livetv']);
        };
        await on(tv, () => syncLiveTv(USER, emptyResult()));
        expect(current.meta.get('sync_baseline:livetv')).toBe('{}');

        // Synchro suivante : les favoris reviennent du cloud, rien n'est retiré du cloud
        await on(tv, () => syncLiveTv(USER, emptyResult()));
        expect([...tv.favorites].sort()).toEqual([10, 20]);
        expect(cloud.user_livetv_bookmarks).toHaveLength(2);
    });

    it('reads every page of a long cloud table (more than 1000 resume points) before deciding anything', async () => {
        const tv = device();
        for (let id = 1; id <= 1500; id++) tv.playback.set(id, progress(id, 1000));
        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect(cloud.user_playback_progress).toHaveLength(1500);

        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect(tv.playback.size).toBe(1500);
    });
});

describe('Posters sent to the cloud (less data sent)', () => {
    const TMDB_POSTER = 'https://image.tmdb.org/t/p/w500/abc.jpg';
    const PROVIDER_POSTER = 'http://provider.example:8080/images/xyz.jpg';

    it('only TMDB posters leave the device; the provider poster stays local', async () => {
        const pc = device();
        const tv = device();
        pc.playback.set(1, { ...progress(1, 1000), poster_url: TMDB_POSTER });
        pc.playback.set(2, { ...progress(2, 2000), poster_url: PROVIDER_POSTER });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        const sent = new Map(cloud.user_playback_progress.map((row) => [row.stream_id, row.poster_url]));
        expect(sent.get(1)).toBe(TMDB_POSTER);
        expect(sent.get(2)).toBeNull();
        expect(pc.playback.get(2)?.poster_url).toBe(PROVIDER_POSTER);

        await on(tv, () => syncPlayback(USER, emptyResult()));
        expect(tv.playback.get(1)?.poster_url).toBe(TMDB_POSTER);
        expect(tv.playback.get(2)?.poster_url).toBeNull();
    });

    it('a newer resume point without a poster keeps the poster already shown on the other device', async () => {
        const pc = device();
        const tv = device();
        pc.playback.set(1, { ...progress(1, 1000), poster_url: PROVIDER_POSTER });
        tv.playback.set(1, { ...progress(1, 500), poster_url: PROVIDER_POSTER });
        await on(pc, () => syncPlayback(USER, emptyResult()));
        await on(tv, () => syncPlayback(USER, emptyResult()));

        expect(tv.playback.get(1)?.updated_at).toBe(1000);
        expect(tv.playback.get(1)?.poster_url).toBe(PROVIDER_POSTER);
    });

    it('an old provider poster already in the cloud is replaced at the next send', async () => {
        const pc = device();
        cloud.user_playback_progress = [{ user_id: USER, ...progress(1, 1000), updated_at: new Date(1000).toISOString(), poster_url: PROVIDER_POSTER }];
        pc.playback.set(1, { ...progress(1, 2000), poster_url: PROVIDER_POSTER });
        await on(pc, () => syncPlayback(USER, emptyResult()));

        expect(cloud.user_playback_progress[0].poster_url).toBeNull();
    });
});
