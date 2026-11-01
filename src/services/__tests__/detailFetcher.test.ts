/**
 * Tests pour detailFetcher.ts : détails film/série depuis SQLite avec cache LRU (50 entrées).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../movieRepository', () => ({
  getMovieById: vi.fn(),
  toIptvStream: vi.fn((e: { stream_id: number }) => ({ stream_id: e.stream_id, mapped: true })),
}));
vi.mock('../seriesRepository', () => ({
  getSeriesById: vi.fn(),
  toIptvSeries: vi.fn((e: { series_id: number }) => ({ series_id: e.series_id, mapped: true })),
}));

import {
  getMovieDetail,
  getSeriesDetail,
  clearDetailCache,
  getDetailCacheStats,
} from '../detailFetcher';
import { getMovieById } from '../movieRepository';
import { getSeriesById } from '../seriesRepository';

const mockMovie = vi.mocked(getMovieById);
const mockSeries = vi.mocked(getSeriesById);

beforeEach(() => {
  vi.clearAllMocks();
  mockMovie.mockReset();
  mockSeries.mockReset();
  clearDetailCache();
});

describe('detailFetcher - films', () => {
  it('construit le film avec le convertisseur central', async () => {
    mockMovie.mockResolvedValueOnce({ stream_id: 5 } as never);
    expect(await getMovieDetail(5)).toEqual({ stream_id: 5, mapped: true });
  });

  it('renvoie null quand le film est introuvable, sans le mettre en cache', async () => {
    mockMovie.mockResolvedValue(undefined as never);
    expect(await getMovieDetail(1)).toBeNull();
    expect(getDetailCacheStats().size).toBe(0);
  });

  it('renvoie null si la lecture SQLite échoue', async () => {
    mockMovie.mockRejectedValueOnce(new Error('SQL'));
    expect(await getMovieDetail(1)).toBeNull();
  });

  it('sert la seconde lecture depuis le cache', async () => {
    mockMovie.mockResolvedValue({ stream_id: 5 } as never);
    const a = await getMovieDetail(5);
    const b = await getMovieDetail(5);
    expect(b).toBe(a);
    expect(mockMovie).toHaveBeenCalledTimes(1);
  });
});

describe('detailFetcher - séries', () => {
  it('construit la série avec le convertisseur central', async () => {
    mockSeries.mockResolvedValueOnce({ series_id: 8 } as never);
    expect(await getSeriesDetail(8)).toEqual({ series_id: 8, mapped: true });
  });

  it('renvoie null quand la série est introuvable', async () => {
    mockSeries.mockResolvedValueOnce(null as never);
    expect(await getSeriesDetail(8)).toBeNull();
  });

  it('renvoie null si la lecture échoue', async () => {
    mockSeries.mockRejectedValueOnce(new Error('SQL'));
    expect(await getSeriesDetail(8)).toBeNull();
  });

  it('met en cache la série', async () => {
    mockSeries.mockResolvedValue({ series_id: 8 } as never);
    await getSeriesDetail(8);
    await getSeriesDetail(8);
    expect(mockSeries).toHaveBeenCalledTimes(1);
  });

  it('ne confond pas un film et une série de même identifiant', async () => {
    mockMovie.mockResolvedValue({ stream_id: 3 } as never);
    mockSeries.mockResolvedValue({ series_id: 3 } as never);
    const movie = await getMovieDetail(3);
    const series = await getSeriesDetail(3);
    expect(movie).toEqual({ stream_id: 3, mapped: true });
    expect(series).toEqual({ series_id: 3, mapped: true });
    expect(getDetailCacheStats().size).toBe(2);
  });
});

describe('detailFetcher - cache LRU', () => {
  it('plafonne le cache à 50 entrées', async () => {
    mockMovie.mockImplementation(async (id: number) => ({ stream_id: id }) as never);
    for (let i = 1; i <= 55; i++) await getMovieDetail(i);
    expect(getDetailCacheStats()).toEqual({ size: 50, maxSize: 50 });
  });

  it('évince la plus ancienne entrée, pas la plus récemment consultée', async () => {
    mockMovie.mockImplementation(async (id: number) => ({ stream_id: id }) as never);
    for (let i = 1; i <= 50; i++) await getMovieDetail(i);
    await getMovieDetail(1); // "touche" le film 1 : le film 2 devient le plus ancien
    await getMovieDetail(51); // déclenche l'éviction
    mockMovie.mockClear();
    await getMovieDetail(1);
    expect(mockMovie).not.toHaveBeenCalled(); // toujours en cache
    await getMovieDetail(2);
    expect(mockMovie).toHaveBeenCalledWith(2); // évincé, relu en base
  });

  it('vide le cache', async () => {
    mockMovie.mockResolvedValue({ stream_id: 1 } as never);
    await getMovieDetail(1);
    clearDetailCache();
    expect(getDetailCacheStats().size).toBe(0);
  });
});
