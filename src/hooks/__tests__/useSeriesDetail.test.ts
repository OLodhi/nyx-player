/**
 * Tests pour useSeriesDetail.ts
 *
 * Vérifie : épisodes pré-chargés, fetch API, season state,
 * persist SQLite, progress reload sur event.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSeriesDetail } from '../useSeriesDetail';
import type { AppSeriesInfo, XtreamEpisode } from '../../types/xtream';

// Mocks
const mockGetSeriesInfo = vi.fn();

vi.mock('../../services/xtreamApi', () => {
  return {
    XtreamApiService: class {
      getSeriesInfo = mockGetSeriesInfo;
    },
  };
});

vi.mock('../../services/storage', () => ({
  StorageService: {
    getCredentials: vi.fn().mockResolvedValue({
      server: 'http://test',
      username: 'user',
      password: 'pass',
    }),
  },
}));

const mockGetProgressByStreamIds = vi.fn().mockResolvedValue(new Map());

vi.mock('../../services/playbackProgressService', () => ({
  getProgressByStreamIds: (...args: unknown[]) => mockGetProgressByStreamIds(...args),
}));

const mockGetLastSeason = vi.fn().mockResolvedValue(null);
const mockSetLastSeason = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/contentPreferencesService', () => ({
  getLastSeason: (...args: unknown[]) => mockGetLastSeason(...args),
  setLastSeason: (...args: unknown[]) => mockSetLastSeason(...args),
}));

// Helpers
function makeEpisode(id: number, season: number): XtreamEpisode {
  return {
    id: String(id),
    episode_num: 1,
    title: `Episode ${id}`,
    season: season,
    container_extension: 'mkv',
  } as unknown as XtreamEpisode;
}

function makeSeries(overrides: Partial<AppSeriesInfo> = {}): AppSeriesInfo {
  return {
    series_id: 1,
    name: 'Test Series',
    tmdb: 42,
    cover: 'https://cover.jpg',
    ...overrides,
  } as unknown as AppSeriesInfo;
}

describe('useSeriesDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('utilise les épisodes pré-chargés sans fetch API', async () => {
    const episodes = {
      '1': [makeEpisode(101, 1), makeEpisode(102, 1)],
      '2': [makeEpisode(201, 2)],
    };

    const { result } = renderHook(() =>
      useSeriesDetail({ series: makeSeries({ episodes }) }),
    );

    expect(result.current.localEpisodes).toBe(episodes);
    expect(result.current.isEpisodesLoading).toBe(false);
    expect(mockGetSeriesInfo).not.toHaveBeenCalled();
  });

  it('fetch les épisodes via API si absents', async () => {
    const apiEpisodes = {
      '1': [makeEpisode(101, 1)],
    };
    mockGetSeriesInfo.mockResolvedValue({ episodes: apiEpisodes });

    const series = makeSeries({ episodes: undefined });

    renderHook(() => useSeriesDetail({ series }));

    // Attendre que la chaîne async (getCredentials → getSeriesInfo) se résolve
    await waitFor(() => {
      expect(mockGetSeriesInfo).toHaveBeenCalledWith(1);
    }, { timeout: 3000 });
  });

  it('handleSeasonChange persiste en SQLite', async () => {
    const episodes = { '1': [makeEpisode(101, 1)], '3': [makeEpisode(301, 3)] };

    const { result } = renderHook(() =>
      useSeriesDetail({ series: makeSeries({ episodes }) }),
    );

    act(() => { result.current.setSelectedSeason(3); });

    expect(result.current.selectedSeason).toBe(3);
    expect(mockSetLastSeason).toHaveBeenCalledWith('tmdb_42', 3);
  });

  it('restore la saison depuis SQLite', async () => {
    mockGetLastSeason.mockResolvedValue(3);

    const episodes = { '1': [makeEpisode(101, 1)], '3': [makeEpisode(301, 3)] };

    const { result } = renderHook(() =>
      useSeriesDetail({ series: makeSeries({ episodes }) }),
    );

    await waitFor(() => {
      expect(result.current.selectedSeason).toBe(3);
    });
  });

  it('charge le progress des épisodes de la saison courante', async () => {
    const episodes = { '1': [makeEpisode(101, 1), makeEpisode(102, 1)] };

    await act(async () => {
      renderHook(() =>
        useSeriesDetail({ series: makeSeries({ episodes }) }),
      );
      await new Promise(r => setTimeout(r, 50));
    });

    expect(mockGetProgressByStreamIds).toHaveBeenCalledWith([101, 102]);
  });

  it('utilise series_id comme identifier si tmdb est absent', () => {
    const episodes = { '1': [makeEpisode(101, 1)] };

    const { result } = renderHook(() =>
      useSeriesDetail({
        series: makeSeries({ tmdb: undefined, episodes }),
      }),
    );

    act(() => { result.current.setSelectedSeason(2); });

    expect(mockSetLastSeason).toHaveBeenCalledWith('1', 2);
  });
});
