/**
 * Rapprochement pur des listes TMDB avec le catalogue (matchTmdbList, buildHeroCandidates) :
 * mêmes règles que les anciennes fonctions getTmdb*AndMatch, qui s'appuient désormais dessus.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { LightIndexes, LightMovie, LightSeries } from '../../types/lightIndex';
import type { TmdbTrendingResult } from '../../types/tmdb';

vi.mock('../tmdbApi', () => ({
  default: {
    imageUrl: (path: string | null) => (path ? `img:${path}` : null),
    getTrending: vi.fn(async () => ({ results: [] })),
    getMovieDetails: vi.fn(async () => ({})),
  },
}));
vi.mock('../tmdbCacheSqlite', () => ({
  getCachedList: vi.fn(async () => null),
  setCachedList: vi.fn(async () => {}),
}));
vi.mock('../../utils/tmdbLanguage', () => ({ getTmdbLanguage: vi.fn(() => 'fr-FR') }));
vi.mock('../../utils/tmdbImageSize', () => ({ backdropImageSize: () => 'w1280' }));

import { buildHeroCandidates, matchTmdbList, readTmdbList } from '../tmdbMatchingService';
import tmdb from '../tmdbApi';
import { getCachedList, setCachedList } from '../tmdbCacheSqlite';
import { getTmdbLanguage } from '../../utils/tmdbLanguage';

function indexes(movies: Array<[number, number]>, series: Array<[number, number]> = []): LightIndexes {
  const m = movies.map(([id, tmdbId]) => ({ id, tmdbId, name: `m${id}`, iconPrefixId: 0, iconSuffix: `m${id}.jpg`, categoryId: '1', added: 0, containerExt: 'mp4' } as LightMovie));
  const s = series.map(([id, tmdbId]) => ({ id, tmdbId, name: `s${id}`, iconPrefixId: 0, iconSuffix: `s${id}.jpg`, categoryId: '2', added: 0 } as LightSeries));
  return {
    movies: new Map(m.map((x) => [x.id, x])),
    series: new Map(s.map((x) => [x.id, x])),
    live: new Map(),
    categories: new Map(),
    moviesByTmdb: new Map(m.map((x) => [x.tmdbId, x])),
    seriesByTmdb: new Map(s.map((x) => [x.tmdbId, x])),
    iconPrefixes: ['http://fournisseur/'],
  };
}

const movie = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, title: `Film ${id}`, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg`, vote_average: 7, overview: 'o', ...extra }) as unknown as TmdbTrendingResult;
const show = (id: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: `Série ${id}`, poster_path: `/p${id}.jpg`, backdrop_path: null, vote_average: 8, overview: '', media_type: 'tv', ...extra }) as unknown as TmdbTrendingResult;

afterEach(() => {
  vi.mocked(getTmdbLanguage).mockReturnValue('fr-FR');
});

describe('matchTmdbList', () => {
  const catalog = indexes([[1, 10], [2, 20]], [[3, 30]]);

  it('tendances : films et séries selon media_type, dans l\'ordre TMDB', () => {
    const rows = matchTmdbList([show(30), movie(10, { media_type: 'movie' }), movie(99, { media_type: 'movie' })], catalog, 'mixed');
    expect(rows.map((r) => [r.id, r.type, r.title])).toEqual([
      [3, 'series', 'Série 30'],
      [1, 'movie', 'Film 10'],
    ]);
  });

  it('tendances : sans media_type, un élément avec titre est un film ; une personne est ignorée', () => {
    const rows = matchTmdbList([movie(10), movie(20, { media_type: 'person' })], catalog, 'mixed');
    expect(rows.map((r) => r.id)).toEqual([1]);
  });

  it('films : titre, puis nom en secours ; doublons et limite respectés', () => {
    const rows = matchTmdbList([movie(10, { title: '', name: 'Nom' }), movie(10), movie(20)], catalog, 'movie', 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, tmdbId: 10, title: 'Nom', type: 'movie', rating: 7, overview: 'o', image: 'img:/p10.jpg' });
  });

  it('séries : cherchées dans les séries du catalogue, pas dans les films', () => {
    expect(matchTmdbList([show(10), show(30)], catalog, 'series').map((r) => r.id)).toEqual([3]);
  });

  it('sans affiche TMDB, l\'image du fournisseur est utilisée', () => {
    const [row] = matchTmdbList([movie(10, { poster_path: null })], catalog, 'movie');
    expect(row.image).toBe('http://fournisseur/m1.jpg');
  });
});

describe('buildHeroCandidates', () => {
  it('films seulement, avec image de fond, au plus `count`', () => {
    const catalog = indexes([[1, 10], [2, 20], [4, 40]], [[3, 30]]);
    const raw = [movie(10), movie(20, { backdrop_path: null }), show(30), movie(40, { release_date: '2024-05-01' })];
    const trending = matchTmdbList(raw, catalog, 'mixed');

    const heroes = buildHeroCandidates(trending, catalog, raw, 5);
    expect(heroes.map((h) => h.id)).toEqual([1, 4]);
    expect(heroes[1]).toMatchObject({ tmdbId: 40, year: '2024', backdropUrl: 'img:/b40.jpg' });
    expect(buildHeroCandidates(trending, catalog, raw, 1)).toHaveLength(1);
  });
});

describe('readTmdbList', () => {
  it('sans réseau : liste absente du cache → null, aucun appel', async () => {
    expect(await readTmdbList('trending', false)).toBeNull();
    expect(tmdb.getTrending).not.toHaveBeenCalled();
  });

  it('avec réseau : télécharge et met en cache', async () => {
    vi.mocked(tmdb.getTrending).mockResolvedValueOnce({ results: [movie(10)] } as never);
    expect(await readTmdbList('trending', true)).toEqual([movie(10)]);
    expect(setCachedList).toHaveBeenCalledWith('trending', [movie(10)]);
  });

  it('langue changée pendant le téléchargement : liste renvoyée mais pas mise en cache', async () => {
    vi.mocked(setCachedList).mockClear();
    vi.mocked(tmdb.getTrending).mockImplementationOnce(async () => {
      vi.mocked(getTmdbLanguage).mockReturnValue('en-US');
      return { results: [movie(10)] } as never;
    });
    expect(await readTmdbList('trending', true)).toEqual([movie(10)]);
    expect(setCachedList).not.toHaveBeenCalled();
  });

  it('liste en cache : renvoyée telle quelle, sans réseau', async () => {
    vi.mocked(getCachedList).mockResolvedValueOnce([movie(20)]);
    vi.mocked(tmdb.getTrending).mockClear();
    expect(await readTmdbList('trending', true)).toEqual([movie(20)]);
    expect(tmdb.getTrending).not.toHaveBeenCalled();
  });
});
