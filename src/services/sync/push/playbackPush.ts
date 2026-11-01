/**
 * playbackPush.ts — Envois immédiats des progressions de lecture vers le cloud (fire-and-forget)
 */

import { supabase } from '../../supabaseClient';
import { canSync, getCurrentSyncUserId } from '../syncState';
import { getLastProviderHash } from '../../preferencesService';
import { currentGeneration } from '../syncBaseline';
import { afterSend } from './afterSend';
import { sendInBackground } from './sendInBackground';
import { cloudPosterUrl } from '../cloudPoster';
import { cloudContainerExtension, cloudNextEpisodeId, cloudTitle } from '../cloudLimits';
import { serverNow } from '../serverClock';

/**
 * Fire-and-forget upsert immédiat d'une progression vers Supabase.
 * Appelé par playbackProgressService.finalizePlayback() après chaque écriture locale.
 */
export function pushPlaybackUpsertToCloud(
  streamId: number,
  contentType: 'movie' | 'episode',
  data: {
    tmdb_id?: number;
    title: string;
    poster_url?: string | null;
    series_id?: number | null;
    season_number?: number | null;
    episode_number?: number | null;
    next_episode_id?: string | null;
    next_season?: number | null;
    next_episode_number?: number | null;
    time_seconds: number;
    duration_seconds: number;
    container_extension?: string | null;
    /** Date locale de la progression (ms) : envoyée pour que le cloud garde la bonne date.
     *  Sans elle, l'heure du serveur (sync/serverClock.ts) */
    updated_at?: number;
  }
): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('playback');
  const updatedAt = data.updated_at ?? serverNow();
  sendInBackground(
    supabase
      .from('user_playback_progress')
      .upsert(
        {
          user_id: userId,
          stream_id: streamId,
          content_type: contentType,
          tmdb_id: data.tmdb_id ?? 0,
          title: cloudTitle(data.title),
          poster_url: cloudPosterUrl(data.poster_url),
          series_id: data.series_id ?? null,
          season_number: data.season_number ?? null,
          episode_number: data.episode_number ?? null,
          next_episode_id: cloudNextEpisodeId(data.next_episode_id),
          next_season: data.next_season ?? null,
          next_episode_number: data.next_episode_number ?? null,
          time_seconds: data.time_seconds,
          duration_seconds: data.duration_seconds,
          container_extension: cloudContainerExtension(data.container_extension),
          updated_at: new Date(updatedAt).toISOString(),
          provider_hash: getLastProviderHash(),
        },
        { onConflict: 'user_id,stream_id' }
      ),
    'playback upsert',
    () => afterSend(userId, 'playback', generation, { set: [[String(streamId), updatedAt]] }),
  );
}

/**
 * Fire-and-forget delete immédiat d'une progression vers Supabase.
 * Appelé par playbackProgressService clear functions.
 */
export function pushPlaybackDeleteToCloud(streamId: number): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('playback');
  sendInBackground(
    supabase
      .from('user_playback_progress')
      .delete()
      .eq('user_id', userId)
      .eq('stream_id', streamId),
    'playback delete',
    () => afterSend(userId, 'playback', generation, { remove: [String(streamId)] }),
  );
}
