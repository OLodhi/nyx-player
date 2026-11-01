/**
 * useEpisodeNavigation.ts — Logique de navigation épisodes pour PlayerControls
 *
 * Extrait depuis App.tsx (Phase 3B).
 * Résout le tmdbId avec fallbacks multiples, calcule onNextEpisode/onPrevEpisode,
 * et construit les seriesMetadata pour Smart Continue.
 */

import { usePlayer } from '../contexts/PlayerContext';
import { findAdjacentEpisode, findEpisodeSeason } from '../utils/episodeNavigation';
import { buildSeriesMetadata } from '../utils/seriesMetadataBuilder';
import { getPlayableTitle, getPlayableId, getPlayableTmdbId } from '../utils/playableHelpers';
import type { XtreamEpisode } from '../types/xtream';
import type { SeriesMetadata } from '../types/player';
import type { TFunction } from 'i18next';

interface EpisodeNavigationResult {
  /** Titre affiché dans le player */
  playerTitle: string;
  /** ID unique du contenu en cours */
  contentId: string;
  /** TMDB ID résolu avec fallbacks multiples */
  resolvedTmdbId: number | undefined;
  /** Callback pour passer à l'épisode suivant (undefined si pas disponible) */
  onNextEpisode: (() => void) | undefined;
  /** Callback pour revenir à l'épisode précédent (undefined si pas disponible) */
  onPrevEpisode: (() => void) | undefined;
  /** Métadonnées série pour Smart Continue */
  seriesMetadata: SeriesMetadata | undefined;
}

/**
 * Hook qui encapsule la logique de navigation épisodes et de résolution TMDB ID.
 *
 * @param selectedMovieTmdbId - TMDB ID du film sélectionné (fallback final)
 * @param t - Fonction de traduction i18next
 */
export function useEpisodeNavigation(
  selectedMovieTmdbId: number | undefined,
  t: TFunction,
): EpisodeNavigationResult {
  const {
    currentlyPlaying,
    currentSeries,
    playNextEpisode,
    playPreviousEpisode,
  } = usePlayer();

  if (!currentlyPlaying) {
    return {
      playerTitle: '',
      contentId: '',
      resolvedTmdbId: undefined,
      onNextEpisode: undefined,
      onPrevEpisode: undefined,
      seriesMetadata: undefined,
    };
  }

  const playerTitle = getPlayableTitle(currentlyPlaying, t);
  const contentId = getPlayableId(currentlyPlaying);

  // Résolution TMDB ID avec 5 fallbacks
  const resolvedTmdbId =
    getPlayableTmdbId(currentlyPlaying) ||
    (currentSeries?.xtreamInfo?.tmdb_id && Number(currentSeries.xtreamInfo.tmdb_id) > 0
      ? Number(currentSeries.xtreamInfo.tmdb_id)
      : undefined) ||
    (currentSeries?.xtreamInfo?.tmdb && Number(currentSeries.xtreamInfo.tmdb) > 0
      ? Number(currentSeries.xtreamInfo.tmdb)
      : undefined) ||
    (currentSeries?.tmdb && currentSeries.tmdb > 0 ? currentSeries.tmdb : undefined) ||
    selectedMovieTmdbId;

  // Episode navigation (séries uniquement)
  const isEpisode = currentSeries?.episodes && 'episode_num' in currentlyPlaying;

  const onNextEpisode = isEpisode
    ? (() => {
        const ep = currentlyPlaying as XtreamEpisode;
        const season = findEpisodeSeason(currentSeries.episodes!, String(ep.id));
        return season !== null && findAdjacentEpisode(currentSeries.episodes!, season, ep.episode_num, 'next')
          ? () => { void playNextEpisode(); }
          : undefined;
      })()
    : undefined;

  const onPrevEpisode = isEpisode
    ? (() => {
        const ep = currentlyPlaying as XtreamEpisode;
        const season = findEpisodeSeason(currentSeries.episodes!, String(ep.id));
        return season !== null && findAdjacentEpisode(currentSeries.episodes!, season, ep.episode_num, 'prev')
          ? () => { void playPreviousEpisode(); }
          : undefined;
      })()
    : undefined;

  // Series metadata pour Smart Continue
  const seriesMetadata = currentSeries && 'episode_num' in currentlyPlaying
    ? buildSeriesMetadata(currentSeries, currentlyPlaying as XtreamEpisode, currentSeries.tmdbTitle)
    : undefined;

  return {
    playerTitle,
    contentId,
    resolvedTmdbId,
    onNextEpisode,
    onPrevEpisode,
    seriesMetadata,
  };
}
