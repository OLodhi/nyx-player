/**
 * lightIndexHelpers : versions d'un même titre (TMDB) et carrousels « Nouveau cette semaine ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAllVersionsByTmdb, getThisWeekMovies, getThisWeekSeries } from '../lightIndexHelpers';
import type { LightIndexes, LightMovie, LightSeries } from '../../types/lightIndex';

const NOW_MS = Date.UTC(2026, 9, 15, 12, 0, 0);
const NOW = NOW_MS / 1000;
const DAY = 86400;

const movie = (id: number, tmdbId: number, added: number, name = `Film ${id}`): LightMovie => ({
  id, name, iconPrefixId: 0, iconSuffix: '', tmdbId, categoryId: '1', added, containerExt: 'mp4',
});
const serie = (id: number, tmdbId: number, added: number, name = `Série ${id}`): LightSeries => ({
  id, name, iconPrefixId: 0, iconSuffix: '', tmdbId, categoryId: '1', added,
});
function indexes(movies: LightMovie[], series: LightSeries[] = []): LightIndexes {
  return {
    movies: new Map(movies.map((m) => [m.id, m])),
    series: new Map(series.map((s) => [s.id, s])),
    live: new Map(), categories: new Map(),
    moviesByTmdb: new Map(), seriesByTmdb: new Map(), iconPrefixes: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});
afterEach(() => vi.useRealTimers());

describe('getAllVersionsByTmdb', () => {
  const idx = indexes(
    [movie(1, 100, 0), movie(2, 100, 0), movie(3, 200, 0)],
    [serie(10, 300, 0), serie(11, 300, 0), serie(12, 400, 0)],
  );

  it('renvoie toutes les versions d\'un film partageant le même TMDB', () => {
    expect(getAllVersionsByTmdb(idx, 100, 'movie').map((m) => m.id)).toEqual([1, 2]);
  });

  it('renvoie toutes les versions d\'une série', () => {
    expect(getAllVersionsByTmdb(idx, 300, 'series').map((s) => s.id)).toEqual([10, 11]);
  });

  it('renvoie une liste vide pour un TMDB inconnu', () => {
    expect(getAllVersionsByTmdb(idx, 999, 'movie')).toEqual([]);
  });

  it('renvoie une liste vide pour un TMDB à 0 (titres non identifiés)', () => {
    const zero = indexes([movie(1, 0, 0), movie(2, 0, 0)]);
    expect(getAllVersionsByTmdb(zero, 0, 'movie')).toEqual([]);
  });

  it('ne mélange pas films et séries', () => {
    expect(getAllVersionsByTmdb(idx, 300, 'movie')).toEqual([]);
    expect(getAllVersionsByTmdb(idx, 100, 'series')).toEqual([]);
  });
});

describe('getThisWeekMovies', () => {
  it('garde les films des 7 derniers jours, du plus récent au plus ancien', () => {
    const idx = indexes([
      movie(1, 1, NOW - 3 * DAY),
      movie(2, 2, NOW - 1 * DAY),
      movie(3, 3, NOW - 8 * DAY),
    ]);
    expect(getThisWeekMovies(idx).map((m) => m.id)).toEqual([2, 1]);
  });

  it('accepte la limite exacte de 7 jours et refuse un jour de plus', () => {
    const idx = indexes([movie(1, 1, NOW - 7 * DAY), movie(2, 2, NOW - 7 * DAY - 1)]);
    expect(getThisWeekMovies(idx).map((m) => m.id)).toEqual([1]);
  });

  it('écarte les films sans date d\'ajout ou sans TMDB', () => {
    const idx = indexes([movie(1, 1, 0), movie(2, 0, NOW - DAY), movie(3, 3, NOW - DAY)]);
    expect(getThisWeekMovies(idx).map((m) => m.id)).toEqual([3]);
  });

  // La déduplication garde la première version rencontrée, avant le tri (lightIndexHelpers.ts, filtre
  // puis sort) : règle actuelle, non confirmée comme voulue (la plus récente serait peut-être préférable).
  it('déduplique par TMDB en gardant la première version rencontrée', () => {
    const idx = indexes([movie(1, 50, NOW - 2 * DAY), movie(2, 50, NOW - DAY)]);
    expect(getThisWeekMovies(idx).map((m) => m.id)).toEqual([1]);
  });

  it('respecte la limite demandée', () => {
    const idx = indexes([1, 2, 3, 4].map((i) => movie(i, i, NOW - i * 3600)));
    expect(getThisWeekMovies(idx, 2).map((m) => m.id)).toEqual([1, 2]);
  });

  it('limite à 20 résultats par défaut', () => {
    const idx = indexes(Array.from({ length: 30 }, (_, i) => movie(i + 1, i + 1, NOW - (i + 1) * 60)));
    expect(getThisWeekMovies(idx)).toHaveLength(20);
  });

  it('filtre les écritures exotiques seulement quand le filtre est actif', () => {
    const idx = indexes([movie(1, 1, NOW - DAY, 'فيلم'), movie(2, 2, NOW - DAY, 'Film latin')]);
    expect(getThisWeekMovies(idx, 20, false).map((m) => m.id).sort()).toEqual([1, 2]);
    expect(getThisWeekMovies(idx, 20, true).map((m) => m.id)).toEqual([2]);
  });
});

describe('getThisWeekSeries', () => {
  it('garde les séries des 7 derniers jours, la plus récente d\'abord', () => {
    const idx = indexes([], [
      serie(1, 1, NOW - 5 * DAY), serie(2, 2, NOW - DAY), serie(3, 3, NOW - 30 * DAY),
    ]);
    expect(getThisWeekSeries(idx).map((s) => s.id)).toEqual([2, 1]);
  });

  it('écarte les séries sans date ou sans TMDB et déduplique par TMDB', () => {
    const idx = indexes([], [
      serie(1, 1, 0), serie(2, 0, NOW - DAY), serie(3, 9, NOW - 2 * DAY), serie(4, 9, NOW - DAY),
    ]);
    expect(getThisWeekSeries(idx).map((s) => s.id)).toEqual([3]);
  });

  it('respecte la limite et le filtre exotique', () => {
    const idx = indexes([], [
      serie(1, 1, NOW - 60, 'مسلسل'), serie(2, 2, NOW - 120), serie(3, 3, NOW - 180),
    ]);
    expect(getThisWeekSeries(idx, 1, true).map((s) => s.id)).toEqual([2]);
    expect(getThisWeekSeries(idx, 2, false).map((s) => s.id)).toEqual([1, 2]);
  });
});
