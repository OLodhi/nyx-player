import { useCallback } from 'react';
import type { AppSeriesInfo } from '../../types/xtream';
import type { PlayableItem, PlayOptions } from '../../types/player';
import { findAdjacentEpisode } from '../../utils/episodeNavigation';
import { devLog } from '../../utils/devLog';
import { resolveCurrentEpisodeInfo } from './streamRequest';
import type { PlayerActions } from './types';

/** Épisode suivant ou précédent de la série en cours, lancé avec play(). */
export function useEpisodeSkip(
    currentSeries: AppSeriesInfo | null,
    currentlyPlaying: PlayableItem | null,
    play: PlayerActions['play'],
): Pick<PlayerActions, 'playNextEpisode' | 'playPreviousEpisode'> {
    // Épisode suivant
    const playNextEpisode = useCallback(async () => {
        const info = resolveCurrentEpisodeInfo(currentSeries, currentlyPlaying);
        if (!info || !currentSeries?.episodes) return;
        const result = findAdjacentEpisode(currentSeries.episodes, info.season, info.episodeNum, 'next');
        if (result) {
            devLog('player', `⏭ Épisode suivant: S${info.season}E${result.episode.episode_num || '?'}`);
            // Propager tmdbId + posterUrl pour que startPlayback() stocke le bon tmdb_id
            // Sans ça, la carte dans "Reprendre" perd son tmdb_id → dédup cassée.
            // Titre officiel de la série aussi, sinon le nom brut du fournisseur est enregistré
            const options: PlayOptions = {
                tmdbId: currentSeries.tmdb ? (typeof currentSeries.tmdb === 'number' ? currentSeries.tmdb : undefined) : undefined,
                tmdbTitle: currentSeries.tmdbTitle,
                posterUrl: currentSeries.cover || undefined,
            };
            await play(result.episode, currentSeries || undefined, undefined, options);
        }
    }, [currentSeries, currentlyPlaying, play]);

    // Épisode précédent
    const playPreviousEpisode = useCallback(async () => {
        const info = resolveCurrentEpisodeInfo(currentSeries, currentlyPlaying);
        if (!info || !currentSeries?.episodes) return;
        const result = findAdjacentEpisode(currentSeries.episodes, info.season, info.episodeNum, 'prev');
        if (result) {
            devLog('player', `⏮ Épisode précédent: S${info.season}E${result.episode.episode_num || '?'}`);
            // Propager tmdbId + posterUrl (même raison que playNextEpisode)
            const options: PlayOptions = {
                tmdbId: currentSeries.tmdb ? (typeof currentSeries.tmdb === 'number' ? currentSeries.tmdb : undefined) : undefined,
                tmdbTitle: currentSeries.tmdbTitle,
                posterUrl: currentSeries.cover || undefined,
            };
            await play(result.episode, currentSeries || undefined, undefined, options);
        }
    }, [currentSeries, currentlyPlaying, play]);

    return { playNextEpisode, playPreviousEpisode };
}
