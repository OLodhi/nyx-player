/**
 * Langue du cache TMDB et Ma liste.
 *
 * `ensureCacheLanguage` vidait tout le cache TMDB au premier lancement après la mise à jour, même en
 * français : Ma liste perdait les noms et affiches officiels, et un titre « Introuvable » les perdait
 * pour de bon (sa fiche ne s'ouvre plus). Ces tests passent par la vraie lecture de Ma liste
 * (`getHydratedWatchlist`) sur une petite base simulée : tables `tmdb_details_cache`, `cache_lists`,
 * `xtream_series_cache`, `watchlist` et `playback_progress`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LightIndexes, LightMovie } from '../../types/lightIndex';

// ============================================================================
// BASE SIMULÉE
// ============================================================================

interface DetailsRow {
    tmdb_id: number;
    type: 'movie' | 'series' | 'season';
    season_number: number;
    display_name: string | null;
    poster_path: string | null;
    full_data: string;
}

interface WatchlistRow { stream_id: number; tmdb_id: number; type: 'movie' | 'series'; added_at: number }

let details: DetailsRow[] = [];
let lists = new Map<string, string>();
let episodesCache: number[] = [];
let watchlist: WatchlistRow[] = [];
let progressTmdbIds: number[] = [];
let meta = new Map<string, string>();

/** Fiches gardées au changement de langue : film ou série de Ma liste ou de « Reprendre » */
const isKept = (row: DetailsRow) =>
    (row.type === 'movie' || row.type === 'series') && row.season_number === 0 && row.tmdb_id > 0
    && (watchlist.some((w) => w.tmdb_id === row.tmdb_id) || progressTmdbIds.includes(row.tmdb_id));

const fakeDb = {
    select: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM cache_lists WHERE cache_key')) {
            const data = lists.get(params[0] as string);
            return data === undefined ? [] : [{ data }];
        }
        if (sql.includes('JOIN tmdb_details_cache')) {
            return [...watchlist].sort((a, b) => b.added_at - a.added_at).map((w) => {
                const t = details.find((d) => d.tmdb_id === w.tmdb_id && d.type === w.type && d.season_number === 0);
                return { ...w, display_name: t?.display_name ?? null, poster_path: t?.poster_path ?? null };
            });
        }
        if (sql.includes('SELECT full_data')) {
            const [tmdbId, type, season] = params;
            return details.filter((d) => d.tmdb_id === tmdbId && d.type === type && d.season_number === season)
                .map((d) => ({ full_data: d.full_data, cached_at: Math.floor(Date.now() / 1000) }));
        }
        throw new Error(`base simulée : lecture non gérée « ${sql} »`);
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('INSERT OR REPLACE INTO cache_lists')) lists.set(params[0] as string, params[1] as string);
        else if (q === 'DELETE FROM cache_lists') lists.clear();
        else if (q === 'DELETE FROM xtream_series_cache') episodesCache = [];
        else if (q === 'DELETE FROM tmdb_details_cache') details = [];
        else if (q.startsWith("UPDATE tmdb_details_cache SET full_data = ''")) {
            for (const row of details) if (isKept(row)) row.full_data = '';
        } else if (q.startsWith('DELETE FROM tmdb_details_cache WHERE NOT')) details = details.filter(isKept);
        else throw new Error(`base simulée : écriture non gérée « ${q} »`);
        return { rowsAffected: 0 };
    }),
};

vi.mock('../dbCore', () => ({
    getDatabase: vi.fn(async () => fakeDb),
    getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
    setMeta: vi.fn(async (key: string, value: string) => { meta.set(key, value); }),
    isDatabaseOf: vi.fn(() => true),
}));

vi.mock('../preferencesService', () => ({
    computeProviderHash: async (host: string) => host,
    getLastProviderHash: () => 'hash-actuel',
}));

vi.mock('../syncService', () => ({
    pushWatchlistUpsertToCloud: vi.fn(),
    pushWatchlistDeleteToCloud: vi.fn(),
}));

vi.mock('../watchlistDetailsFill', () => ({
    requestMissingWatchlistDetails: vi.fn(),
}));

vi.mock('../tmdbApi', () => ({
    default: { imageUrl: (path: string) => `https://image.tmdb.org/t/p/w342${path}` },
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import { ensureCacheLanguage, getCachedDetails } from '../tmdbCacheSqlite';
import { getHydratedWatchlist } from '../watchlistHydration';

// ============================================================================
// HELPERS
// ============================================================================

const LANGUAGE_KEY = '__tmdb_cache_language';

function movie(id: number, tmdbId: number, name: string): LightMovie {
    return { id, name, iconPrefixId: 0, iconSuffix: `${id}.jpg`, tmdbId, categoryId: '1', added: 0, containerExt: 'mkv' };
}

function catalog(movies: LightMovie[]): LightIndexes {
    return {
        movies: new Map(movies.map((m) => [m.id, m])),
        series: new Map(),
        live: new Map(),
        categories: new Map(),
        moviesByTmdb: new Map(movies.filter((m) => m.tmdbId > 0).map((m) => [m.tmdbId, m])),
        seriesByTmdb: new Map(),
        iconPrefixes: ['http://fournisseur.test/images/'],
    };
}

function tmdbRow(tmdb_id: number, name: string, type: DetailsRow['type'] = 'movie', season_number = 0): DetailsRow {
    return {
        tmdb_id, type, season_number, display_name: name, poster_path: `/${tmdb_id}.jpg`,
        full_data: JSON.stringify({ id: tmdb_id, title: name, backdrop_path: '/fond.jpg' }),
    };
}

/**
 * Appareil sorti de la 0.7.6 : Ma liste avec un film présent chez le fournisseur (42) et un film
 * « Introuvable » (77, son numéro 300 a été repris par un autre film) ; un film en cours dans
 * « Reprendre » (55) ; un film seulement consulté (99) et une saison consultée (série 10).
 */
function deviceFrom076() {
    watchlist = [
        { stream_id: 100, tmdb_id: 42, type: 'movie', added_at: 2 },
        { stream_id: 300, tmdb_id: 77, type: 'movie', added_at: 1 },
    ];
    progressTmdbIds = [55];
    details = [
        tmdbRow(42, 'Le Nom Officiel'),
        tmdbRow(77, 'Le Film Disparu'),
        tmdbRow(55, 'Le Film En Cours'),
        tmdbRow(99, 'Un Film Consulté'),
        tmdbRow(10, 'Une Série', 'season', 1),
    ];
    lists = new Map([['trending', '[]']]);
    episodesCache = [10];
    return catalog([movie(100, 42, 'FR| Le.Nom.2020.1080p'), movie(300, 88, 'Un Autre Film')]);
}

beforeEach(() => {
    details = [];
    lists = new Map();
    episodesCache = [];
    watchlist = [];
    progressTmdbIds = [];
    meta = new Map([['lastProvider', 'hash-actuel']]);
    vi.clearAllMocks();
});

// ============================================================================
// TESTS
// ============================================================================

describe('Langue du cache TMDB et Ma liste', () => {
    it('first launch after 0.7.6 in French: nothing is cleared, Ma liste keeps its TMDB names and posters', async () => {
        const indexes = deviceFrom076();

        expect(await ensureCacheLanguage('fr-FR')).toBe(false);

        expect(lists.get(LANGUAGE_KEY)).toBe('fr-FR');
        expect(details).toHaveLength(5);
        expect(episodesCache).toEqual([10]);
        const items = await getHydratedWatchlist(indexes);
        expect(items.map((i) => [i.name, i.posterUrl])).toEqual([
            ['Le Nom Officiel', 'https://image.tmdb.org/t/p/w342/42.jpg'],
            ['Le Film Disparu', 'https://image.tmdb.org/t/p/w342/77.jpg'],
        ]);
        expect(items[1].isOrphan).toBe(true);
    });

    it('a real language change keeps the name and poster of Ma liste, the unavailable title included', async () => {
        const indexes = deviceFrom076();
        lists.set(LANGUAGE_KEY, 'fr-FR');

        expect(await ensureCacheLanguage('en-US')).toBe(true);

        const items = await getHydratedWatchlist(indexes);
        expect(items.map((i) => i.name)).toEqual(['Le Nom Officiel', 'Le Film Disparu']);
        expect(items.every((i) => i.posterUrl.startsWith('https://image.tmdb.org/'))).toBe(true);
        expect(lists.get(LANGUAGE_KEY)).toBe('en-US');
    });

    it('a real language change asks TMDB again for kept pages, and drops the rest except provider episodes', async () => {
        deviceFrom076();
        lists.set(LANGUAGE_KEY, 'fr-FR');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        await ensureCacheLanguage('en-US');

        // Ma liste et « Reprendre » : ligne gardée pour l'affichage, fiche redemandée dans la nouvelle langue
        expect(details.map((d) => d.tmdb_id).sort((a, b) => a - b)).toEqual([42, 55, 77]);
        expect(await getCachedDetails(42, 'movie')).toBeNull();
        expect(await getCachedDetails(55, 'movie')).toBeNull();
        // Listes de l'accueil vidées (seul le témoin de langue reste), épisodes du fournisseur gardés
        expect([...lists.keys()]).toEqual([LANGUAGE_KEY]);
        expect(episodesCache).toEqual([10]);
        expect(error).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('without a noted language, a non-French app still gets a fresh cache, Ma liste names kept', async () => {
        const indexes = deviceFrom076();

        expect(await ensureCacheLanguage('en-US')).toBe(true);

        expect(details.map((d) => d.tmdb_id).sort((a, b) => a - b)).toEqual([42, 55, 77]);
        const items = await getHydratedWatchlist(indexes);
        expect(items.map((i) => i.name)).toEqual(['Le Nom Officiel', 'Le Film Disparu']);
    });

});
