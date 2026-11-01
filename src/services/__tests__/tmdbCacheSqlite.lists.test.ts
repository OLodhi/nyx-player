/**
 * tmdbCacheSqlite : écritures des fiches (film, série, saison), listes à durée de vie,
 * abonnements aux mises à jour, statistiques, vidage sélectif et commandes de console.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
};
vi.mock('../dbCore', () => ({ getDatabase: vi.fn(() => Promise.resolve(mockDb)) }));

import {
  onDetailsUpdate,
  cacheMovieDetails,
  cacheSeriesDetails,
  cacheSeasonDetails,
  getCachedList,
  setCachedList,
  getCacheStats,
  clearCacheByType,
  clearAllCache,
  ensureCacheLanguage,
} from '../tmdbCacheSqlite';
import { getDatabase } from '../dbCore';
import type { TmdbMovieDetails, TmdbTvDetails } from '../../types/tmdb';

const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);
const NOW = NOW_MS / 1000;
const WEEK = 7 * 24 * 3600;
const DAY = 24 * 3600;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  mockDb.select.mockResolvedValue([]);
  mockDb.execute.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('tmdbCacheSqlite - écriture des films', () => {
  const movie = {
    id: 603, title: 'Matrix', release_date: '1999-03-31', poster_path: '/p.jpg',
    backdrop_path: '/b.jpg', overview: 'Un hacker', vote_average: 0,
  } as unknown as TmdbMovieDetails;

  it('enregistre les champs unifiés, la fiche complète et une durée de 7 jours', async () => {
    await cacheMovieDetails(603, movie);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain("VALUES (?, 'movie', 0");
    expect(params).toEqual([
      603, 'Matrix', '1999-03-31', '/p.jpg', '/b.jpg', 'Un hacker', 0,
      JSON.stringify(movie), NOW, WEEK, 603,
    ]);
  });

  it('conserve la protection is_referenced déjà posée sur la fiche', async () => {
    await cacheMovieDetails(603, movie);
    expect(String(mockDb.execute.mock.calls[0][0])).toContain('COALESCE((SELECT is_referenced FROM tmdb_details_cache');
  });

  it('remplace les champs absents par null (une note à 0 reste 0)', async () => {
    await cacheMovieDetails(1, { id: 1 } as unknown as TmdbMovieDetails);
    const params = mockDb.execute.mock.calls[0][1] as unknown[];
    expect(params.slice(1, 7)).toEqual([null, null, null, null, null, null]);
  });

  it('prévient les abonnés avec le type film', async () => {
    const cb = vi.fn();
    const off = onDetailsUpdate(cb);
    await cacheMovieDetails(603, movie);
    expect(cb).toHaveBeenCalledWith(603, 'movie');
    off();
  });

  it('ne prévient personne si l\'écriture échoue', async () => {
    const cb = vi.fn();
    const off = onDetailsUpdate(cb);
    mockDb.execute.mockRejectedValueOnce(new Error('SQL'));
    await expect(cacheMovieDetails(603, movie)).resolves.toBeUndefined();
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});

describe('tmdbCacheSqlite - écriture des séries et saisons', () => {
  const tv = {
    id: 1399, name: 'Thrones', first_air_date: '2011-04-17', number_of_seasons: 8, vote_average: 8.4,
  } as unknown as TmdbTvDetails;

  it('enregistre nom, date de première diffusion et nombre de saisons', async () => {
    await cacheSeriesDetails(1399, tv);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain("VALUES (?, 'series', 0");
    expect(params).toEqual([
      1399, 'Thrones', '2011-04-17', null, null, null, 8.4, 8,
      JSON.stringify(tv), NOW, WEEK, 1399,
    ]);
  });

  it('prévient les abonnés avec le type série', async () => {
    const cb = vi.fn();
    const off = onDetailsUpdate(cb);
    await cacheSeriesDetails(1399, tv);
    expect(cb).toHaveBeenCalledWith(1399, 'series');
    off();
  });

  it('ne prévient personne si l\'écriture de la série échoue', async () => {
    const cb = vi.fn();
    const off = onDetailsUpdate(cb);
    mockDb.execute.mockRejectedValueOnce(new Error('SQL'));
    await cacheSeriesDetails(1399, tv);
    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it('enregistre une saison avec son numéro et sans protection', async () => {
    const season = { episodes: [{ id: 1 }] };
    await cacheSeasonDetails(1399, 2, season);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain("'season', ?");
    expect(params).toEqual([1399, 2, JSON.stringify(season), NOW, WEEK]);
  });

  it('avale l\'erreur d\'écriture d\'une saison', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('SQL'));
    await expect(cacheSeasonDetails(1, 1, {})).resolves.toBeUndefined();
  });

  it('se désabonne : le rappel n\'est plus appelé', async () => {
    const cb = vi.fn();
    const off = onDetailsUpdate(cb);
    off();
    await cacheSeriesDetails(1, tv);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('tmdbCacheSqlite - listes', () => {
  it('renvoie null quand la liste n\'existe pas', async () => {
    expect(await getCachedList('trending')).toBeNull();
    expect(mockDb.select.mock.calls[0][1]).toEqual(['trending']);
  });

  it('renvoie la liste quand elle est encore valide', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: '[{"id":1}]', cached_at: NOW - 3600, ttl_seconds: DAY }]);
    expect(await getCachedList<{ id: number }>('popular')).toEqual([{ id: 1 }]);
  });

  it('renvoie null quand la liste est expirée', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: '[{"id":1}]', cached_at: NOW - 2 * DAY, ttl_seconds: DAY }]);
    expect(await getCachedList('popular')).toBeNull();
  });

  it('renvoie null quand le JSON de la liste est corrompu', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: '[pas du json', cached_at: NOW, ttl_seconds: DAY }]);
    expect(await getCachedList('genre_28')).toBeNull();
  });

  it('enregistre une liste avec une durée de 24 heures', async () => {
    await setCachedList('hero', [{ id: 5 }]);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain('INSERT OR REPLACE INTO cache_lists');
    expect(params).toEqual(['hero', '[{"id":5}]', NOW, DAY]);
  });

  it('avale l\'erreur d\'écriture d\'une liste', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('SQL'));
    await expect(setCachedList('hero', [])).resolves.toBeUndefined();
  });
});

describe('tmdbCacheSqlite - statistiques et vidage', () => {
  it('additionne les compteurs de toutes les tables', async () => {
    mockDb.select
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ count: 5 }])
      .mockResolvedValueOnce([{ count: 7 }])
      .mockResolvedValueOnce([{ count: 11 }]);
    expect(await getCacheStats()).toEqual({
      movies: 3, series: 2, seasons: 5, lists: 7, xtreamSeries: 11, total: 28,
    });
  });

  it('compte 0 quand une table ne renvoie pas de ligne', async () => {
    mockDb.select.mockResolvedValue([]);
    expect(await getCacheStats()).toEqual({
      movies: 0, series: 0, seasons: 0, lists: 0, xtreamSeries: 0, total: 0,
    });
  });

  it('vide seulement les films', async () => {
    await clearCacheByType('movies');
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    expect(mockDb.execute).toHaveBeenCalledWith("DELETE FROM tmdb_details_cache WHERE type = 'movie'");
  });

  it('vide séries, saisons et épisodes du fournisseur pour les séries', async () => {
    await clearCacheByType('series');
    const sqls = mockDb.execute.mock.calls.map((c) => c[0]);
    expect(sqls).toContain("DELETE FROM tmdb_details_cache WHERE type IN ('series', 'season')");
    expect(sqls).toContain('DELETE FROM xtream_series_cache');
    expect(sqls).toHaveLength(2);
  });

  it('vide les trois tables de cache', async () => {
    await clearAllCache();
    expect(mockDb.execute.mock.calls.map((c) => c[0]).sort()).toEqual([
      'DELETE FROM cache_lists',
      'DELETE FROM tmdb_details_cache',
      'DELETE FROM xtream_series_cache',
    ]);
  });
});

describe('tmdbCacheSqlite - ensureCacheLanguage, cas d\'erreur', () => {
  it('renvoie false sans lever d\'erreur si la base échoue', async () => {
    vi.mocked(getDatabase).mockRejectedValueOnce(new Error('fermée'));
    expect(await ensureCacheLanguage('en-US')).toBe(false);
  });

  it('note la langue avec une durée de vie nulle', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: 'fr-FR' }]);
    expect(await ensureCacheLanguage('en-US')).toBe(true);
    const last = mockDb.execute.mock.calls[mockDb.execute.mock.calls.length - 1];
    expect(last[1]).toEqual(['__tmdb_cache_language', 'en-US', NOW, 0]);
  });

  it('vide cache_lists en dernier pour qu\'un arrêt en cours de route recommence', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: 'fr-FR' }]);
    await ensureCacheLanguage('en-US');
    const sqls = mockDb.execute.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toContain("UPDATE tmdb_details_cache SET full_data = ''");
    expect(sqls[1]).toContain('DELETE FROM tmdb_details_cache WHERE NOT');
    expect(sqls[2]).toBe('DELETE FROM cache_lists');
  });
});

describe('tmdbCacheSqlite - commandes de console window.debug*', () => {
  type DebugFn = () => Promise<void>;
  const win = window as unknown as Record<string, DebugFn>;

  beforeEach(() => {
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('expose les quatre commandes', () => {
    for (const name of ['debugTmdbCacheStats', 'debugClearTmdbCache', 'debugTmdbCacheList', 'debugAgeTmdbCache']) {
      expect(typeof win[name]).toBe('function');
    }
  });

  it('debugClearTmdbCache vide tout le cache', async () => {
    await win.debugClearTmdbCache();
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('debugAgeTmdbCache vieillit les entrées à 8 jours', async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 4 }]);
    await win.debugAgeTmdbCache();
    expect(mockDb.execute).toHaveBeenCalledWith(
      'UPDATE tmdb_details_cache SET cached_at = ?',
      [NOW - 8 * DAY]
    );
  });

  it('debugTmdbCacheStats affiche un tableau', async () => {
    mockDb.select.mockResolvedValue([{ count: 1, referenced: 0 }]);
    await win.debugTmdbCacheStats();
    expect(console.table).toHaveBeenCalledTimes(1);
  });

  it('debugTmdbCacheList affiche les entrées avec un nom de repli', async () => {
    mockDb.select.mockResolvedValueOnce([
      { tmdb_id: 1, type: 'movie', season_number: 0, display_name: null, cached_at: NOW - 7200 },
    ]);
    await win.debugTmdbCacheList();
    const rows = vi.mocked(console.table).mock.calls[0][0] as { name: string; age_hours: number }[];
    expect(rows[0].name).toBe('(no name)');
  });
});
