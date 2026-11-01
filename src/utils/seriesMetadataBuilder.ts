/**
 * seriesMetadataBuilder.ts — Construction des métadonnées série pour Smart Continue
 *
 * Migré depuis App.tsx. Centralise la logique de buildSeriesMetadata
 * qui crée l'objet SeriesMetadata pour PlayerControls.
 */

import type { XtreamEpisode, AppSeriesInfo } from '../types/xtream';
import { type SeriesMetadata } from '../types/player';
import { normalizeTmdbId } from './normalizeTmdb';
import { findAdjacentEpisode, findEpisodeSeason } from './episodeNavigation';

/**
 * Construit les métadonnées série pour le Smart Continue.
 * Utilisé pour sauvegarder le contexte épisode avec la progression.
 *
 * @param series - AppSeriesInfo avec les épisodes
 * @param episode - L'épisode en cours de lecture
 * @param tmdbTitle - Titre TMDB propre (optionnel)
 */
export function buildSeriesMetadata(
  series: AppSeriesInfo,
  episode: XtreamEpisode,
  tmdbTitle?: string
): SeriesMetadata {
  // Trouver le numéro de saison via la helper canonique
  const seasonNumber = (series.episodes
    ? findEpisodeSeason(series.episodes, episode.id)
    : null) ?? 1;

  // Smart Continue: calculer l'épisode suivant
  const nextResult = series.episodes
    ? findAdjacentEpisode(series.episodes, seasonNumber, episode.episode_num, 'next')
    : null;

  const nextEpisode = nextResult
    ? {
        episodeId: nextResult.episode.id,
        seasonNumber: nextResult.seasonNumber,
        episodeNumber: nextResult.episode.episode_num,
        episodeTitle: nextResult.episode.title,
        episodeCover: nextResult.episode.info?.movie_image,
        containerExtension: nextResult.episode.container_extension,
      }
    : null;

  return {
    seriesId: Number(series.series_id),
    tmdbId: normalizeTmdbId(series.tmdb) || undefined,
    seriesName: series.name,
    seriesNameTmdb: tmdbTitle,
    seriesCover: series.cover,
    seasonNumber,
    episodeNumber: episode.episode_num,
    episodeTitle: episode.title,
    episodeId: episode.id,
    containerExtension: episode.container_extension || 'ts',
    nextEpisode,
  };
}
