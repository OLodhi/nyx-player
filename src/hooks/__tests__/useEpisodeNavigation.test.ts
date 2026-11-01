/**
 * Tests pour useEpisodeNavigation.ts
 * Vérifie : titre et identifiant, résolution de l'identifiant TMDB, boutons épisode suivant/précédent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { XtreamEpisode } from '../../types/xtream';

type PlayerMock = {
  currentlyPlaying: unknown;
  currentSeries: unknown;
  playNextEpisode: ReturnType<typeof vi.fn>;
  playPreviousEpisode: ReturnType<typeof vi.fn>;
};

const player: PlayerMock = {
  currentlyPlaying: null,
  currentSeries: null,
  playNextEpisode: vi.fn(),
  playPreviousEpisode: vi.fn(),
};

vi.mock('../../contexts/PlayerContext', () => ({
  usePlayer: () => player,
}));

import { useEpisodeNavigation } from '../useEpisodeNavigation';

const t = ((key: string) => key) as unknown as TFunction;

function ep(id: string, num: number): XtreamEpisode {
  return { id, episode_num: num, title: `Episode ${num}`, container_extension: 'mkv' } as unknown as XtreamEpisode;
}

const episodes = {
  1: [ep('11', 1), ep('12', 2)],
  2: [ep('21', 1)],
};

describe('useEpisodeNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.currentlyPlaying = null;
    player.currentSeries = null;
  });

  it('renvoie des valeurs vides quand rien n\'est lu', () => {
    const { result } = renderHook(() => useEpisodeNavigation(99, t));
    expect(result.current).toEqual({
      playerTitle: '',
      contentId: '',
      resolvedTmdbId: undefined,
      onNextEpisode: undefined,
      onPrevEpisode: undefined,
      seriesMetadata: undefined,
    });
  });

  describe('Film', () => {
    it('donne le titre, l\'identifiant et l\'identifiant TMDB du film', () => {
      player.currentlyPlaying = { stream_id: 7, name: 'Mon film', tmdb: '123' };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.playerTitle).toBe('Mon film');
      expect(result.current.contentId).toBe('7');
      expect(result.current.resolvedTmdbId).toBe(123);
      expect(result.current.onNextEpisode).toBeUndefined();
      expect(result.current.seriesMetadata).toBeUndefined();
    });

    it('se rabat sur l\'identifiant TMDB du film sélectionné', () => {
      player.currentlyPlaying = { stream_id: 7, name: 'Mon film' };
      const { result } = renderHook(() => useEpisodeNavigation(555, t));
      expect(result.current.resolvedTmdbId).toBe(555);
    });

    it('affiche le libellé « lecture en cours » quand le titre manque', () => {
      player.currentlyPlaying = { stream_id: 7 };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.playerTitle).toBe('playing_now');
    });
  });

  describe('Résolution de l\'identifiant TMDB d\'une série', () => {
    beforeEach(() => {
      player.currentlyPlaying = ep('12', 2);
    });

    it('préfère l\'identifiant TMDB des informations Xtream', () => {
      player.currentSeries = { episodes, tmdb: 3, xtreamInfo: { tmdb_id: '10', tmdb: '20' } };
      const { result } = renderHook(() => useEpisodeNavigation(999, t));
      expect(result.current.resolvedTmdbId).toBe(10);
    });

    it('passe au champ tmdb des informations Xtream si tmdb_id est invalide', () => {
      player.currentSeries = { episodes, tmdb: 3, xtreamInfo: { tmdb_id: '0', tmdb: '20' } };
      const { result } = renderHook(() => useEpisodeNavigation(999, t));
      expect(result.current.resolvedTmdbId).toBe(20);
    });

    it('passe à l\'identifiant de la série puis à celui du film sélectionné', () => {
      player.currentSeries = { episodes, tmdb: 3 };
      expect(renderHook(() => useEpisodeNavigation(999, t)).result.current.resolvedTmdbId).toBe(3);
      player.currentSeries = { episodes, tmdb: 0 };
      expect(renderHook(() => useEpisodeNavigation(999, t)).result.current.resolvedTmdbId).toBe(999);
    });
  });

  describe('Épisodes suivant et précédent', () => {
    it('propose le suivant dans la saison suivante et pas de précédent au premier épisode', () => {
      player.currentlyPlaying = ep('11', 1);
      player.currentSeries = { series_id: '1', name: 'Serie', episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.onNextEpisode).toBeTypeOf('function');
      expect(result.current.onPrevEpisode).toBeUndefined();
    });

    it('appelle la lecture de l\'épisode suivant', () => {
      player.currentlyPlaying = ep('11', 1);
      player.currentSeries = { series_id: '1', name: 'Serie', episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      result.current.onNextEpisode?.();
      expect(player.playNextEpisode).toHaveBeenCalledTimes(1);
      expect(player.playPreviousEpisode).not.toHaveBeenCalled();
    });

    it('appelle la lecture de l\'épisode précédent', () => {
      player.currentlyPlaying = ep('12', 2);
      player.currentSeries = { series_id: '1', name: 'Serie', episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      result.current.onPrevEpisode?.();
      expect(player.playPreviousEpisode).toHaveBeenCalledTimes(1);
    });

    it('ne propose pas de suivant au dernier épisode de la série', () => {
      player.currentlyPlaying = ep('21', 1);
      player.currentSeries = { series_id: '1', name: 'Serie', episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.onNextEpisode).toBeUndefined();
      expect(result.current.onPrevEpisode).toBeTypeOf('function');
    });

    it('ne propose rien quand l\'épisode est absent de la liste', () => {
      player.currentlyPlaying = ep('99', 9);
      player.currentSeries = { series_id: '1', name: 'Serie', episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.onNextEpisode).toBeUndefined();
      expect(result.current.onPrevEpisode).toBeUndefined();
    });

    it('prépare les métadonnées de la série avec l\'épisode suivant', () => {
      player.currentlyPlaying = ep('11', 1);
      player.currentSeries = { series_id: '5', name: 'Serie', tmdb: 8, episodes };
      const { result } = renderHook(() => useEpisodeNavigation(undefined, t));
      expect(result.current.seriesMetadata).toMatchObject({ seriesId: 5, seriesName: 'Serie' });
    });
  });
});
