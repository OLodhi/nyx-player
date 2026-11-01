/**
 * Ouverture d'un titre par navigateToContent : un numéro de source repris par un
 * autre titre n'ouvre jamais ce dernier ; le titre est alors cherché par son numéro TMDB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LightIndexes, LightMovie, LightSeries } from '../../types/lightIndex';

const navigateToMovie = vi.fn();
const navigateToSeries = vi.fn();
let lightIndexes: LightIndexes | null = null;
let details = new Map<string, Record<string, unknown>>();

vi.mock('../../contexts/NavigationContext', () => ({
    useNavigation: () => ({ navigateToMovie, navigateToSeries }),
}));

vi.mock('../../contexts/SessionContext', () => ({
    useSession: () => ({ lightIndexes }),
}));

vi.mock('../../services/detailFetcher', () => ({
    getMovieDetail: vi.fn(async (id: number) => details.get(`movie:${id}`) ?? null),
    getSeriesDetail: vi.fn(async (id: number) => details.get(`series:${id}`) ?? null),
}));

vi.mock('../../services/contentPreferencesService', () => ({
    getPreferredSource: vi.fn(async () => null),
}));

vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { useContentNavigation, cancelPendingOpen } from '../useContentNavigation';

function movie(id: number, tmdbId: number): LightMovie {
    return { id, name: `Film ${id}`, iconPrefixId: 0, iconSuffix: '', tmdbId, categoryId: '1', added: 0, containerExt: 'mkv' };
}

function series(id: number, tmdbId: number): LightSeries {
    return { id, name: `Série ${id}`, iconPrefixId: 0, iconSuffix: '', tmdbId, categoryId: '1', added: 0 } as LightSeries;
}

function catalog(movies: LightMovie[], seriesList: LightSeries[] = []): LightIndexes {
    return {
        movies: new Map(movies.map((m) => [m.id, m])),
        series: new Map(seriesList.map((s) => [s.id, s])),
        live: new Map(),
        categories: new Map(),
        moviesByTmdb: new Map(movies.filter((m) => m.tmdbId > 0).map((m) => [m.tmdbId, m])),
        seriesByTmdb: new Map(seriesList.filter((s) => s.tmdbId > 0).map((s) => [s.tmdbId, s])),
        iconPrefixes: [],
    };
}

function addMovieDetail(id: number, tmdb: number) {
    details.set(`movie:${id}`, { stream_id: id, name: `Film ${id}`, tmdb });
}

async function open(type: 'movie' | 'series', identifier: { tmdbId: number; streamId?: number; seriesId?: number }) {
    const { result } = renderHook(() => useContentNavigation());
    await act(async () => {
        await result.current.navigateToContent(type, identifier);
    });
}

/** Numéros des versions passées à la page du film ouverte */
const openedMovieIds = () =>
    (navigateToMovie.mock.calls[0][1] as { stream_id: number }[]).map((v) => Number(v.stream_id));

beforeEach(() => {
    navigateToMovie.mockClear();
    navigateToSeries.mockClear();
    details = new Map();
    lightIndexes = null;
});

describe('navigateToContent', () => {
    it('opens the movie at its source number when it is the same TMDB title', async () => {
        lightIndexes = catalog([movie(100, 42)]);
        addMovieDetail(100, 42);
        await open('movie', { tmdbId: 42, streamId: 100 });
        expect(navigateToMovie).toHaveBeenCalledWith(42, expect.any(Array));
        expect(openedMovieIds()).toEqual([100]);
    });

    it('never opens another title that took the source number, and finds it by TMDB instead', async () => {
        lightIndexes = catalog([movie(100, 99), movie(500, 42)]);
        addMovieDetail(100, 99); // autre film au même numéro
        addMovieDetail(500, 42);
        await open('movie', { tmdbId: 42, streamId: 100 });
        expect(navigateToMovie).toHaveBeenCalledTimes(1);
        expect(navigateToMovie.mock.calls[0][0]).toBe(42);
        expect(openedMovieIds()).toEqual([500]);
    });

    it('finds the title by TMDB when its source number no longer exists', async () => {
        lightIndexes = catalog([movie(500, 42)]);
        addMovieDetail(500, 42);
        await open('movie', { tmdbId: 42, streamId: 100 });
        expect(openedMovieIds()).toEqual([500]);
    });

    it('opens nothing when the title is not in the catalog', async () => {
        lightIndexes = catalog([movie(100, 99)]);
        addMovieDetail(100, 99);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await open('movie', { tmdbId: 42, streamId: 100 });
        expect(navigateToMovie).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('still opens a title without TMDB id by its source number', async () => {
        lightIndexes = catalog([movie(100, 0)]);
        addMovieDetail(100, 0);
        await open('movie', { tmdbId: 0, streamId: 100 });
        expect(navigateToMovie).toHaveBeenCalledWith(0, [expect.objectContaining({ stream_id: 100 })]);
    });

    it('does the same for series', async () => {
        lightIndexes = catalog([], [series(100, 99), series(700, 77)]);
        details.set('series:100', { series_id: 100, name: 'Autre série', tmdb: 99 });
        details.set('series:700', { series_id: 700, name: 'La série', tmdb: 77 });
        await open('series', { tmdbId: 77, seriesId: 100 });
        expect(navigateToSeries).toHaveBeenCalledTimes(1);
        expect(navigateToSeries.mock.calls[0][0]).toMatchObject({ series_id: 700, tmdb: 77 });
    });
});

describe('deux cartes pressées très vite', () => {
    it('la dernière carte pressée gagne, même si la base répond d\'abord pour elle', async () => {
        lightIndexes = catalog([movie(1, 11), movie(2, 22)]);
        addMovieDetail(2, 22);
        let releaseFirst!: () => void;
        const { getMovieDetail } = await import('../../services/detailFetcher');
        vi.mocked(getMovieDetail).mockImplementationOnce(
            (id: number) => new Promise((resolve) => {
                releaseFirst = () => resolve({ stream_id: id, name: `Film ${id}`, tmdb: 11 } as never);
            }),
        );
        const { result } = renderHook(() => useContentNavigation());

        await act(async () => {
            const first = result.current.openMovie({ stream_id: 1, name: 'Film 1', tmdb: 11 } as never);
            const second = result.current.openMovie({ stream_id: 2, name: 'Film 2', tmdb: 22 } as never);
            await second;
            releaseFirst();
            await first;
        });

        expect(navigateToMovie).toHaveBeenCalledTimes(1);
        expect(navigateToMovie.mock.calls[0][0]).toBe(22);
    });

    it('pareil entre une série et un film', async () => {
        lightIndexes = catalog([movie(2, 22)], [series(7, 77)]);
        addMovieDetail(2, 22);
        let releaseSeries!: () => void;
        const { getSeriesDetail } = await import('../../services/detailFetcher');
        vi.mocked(getSeriesDetail).mockImplementationOnce(
            (id: number) => new Promise((resolve) => {
                releaseSeries = () => resolve({ series_id: id, name: `Série ${id}`, tmdb: 77 } as never);
            }),
        );
        const { result } = renderHook(() => useContentNavigation());

        await act(async () => {
            const first = result.current.openSeries({ series_id: 7, name: 'Série 7', tmdb: 77 } as never);
            const second = result.current.openMovie({ stream_id: 2, name: 'Film 2', tmdb: 22 } as never);
            await second;
            releaseSeries();
            await first;
        });

        expect(navigateToSeries).not.toHaveBeenCalled();
        expect(navigateToMovie).toHaveBeenCalledTimes(1);
    });

    it('retour arrière pendant l\'attente : la fiche demandée ne s\'ouvre plus', async () => {
        lightIndexes = catalog([movie(1, 11)]);
        let release!: () => void;
        const { getMovieDetail } = await import('../../services/detailFetcher');
        vi.mocked(getMovieDetail).mockImplementationOnce(
            (id: number) => new Promise((resolve) => {
                release = () => resolve({ stream_id: id, name: `Film ${id}`, tmdb: 11 } as never);
            }),
        );
        const { result } = renderHook(() => useContentNavigation());

        await act(async () => {
            const opening = result.current.openMovie({ stream_id: 1, name: 'Film 1', tmdb: 11 } as never);
            await Promise.resolve();
            cancelPendingOpen();
            release();
            await opening;
        });

        expect(navigateToMovie).not.toHaveBeenCalled();
    });
});
