/**
 * contentPreferencesService.ts — Préférences liées à un contenu spécifique
 *
 * Gère : source préférée, dernière saison, vitesse de lecture, pistes audio/sub.
 * Stockage : table SQLite `content_preferences` (content_type, identifier, key → value).
 * Pas de cache mémoire global (clés dynamiques, lectures ponctuelles).
 *
 * Migration one-shot depuis localStorage au boot.
 */

import { getDatabase } from './dbCore';
import { createLogger } from '../utils/logger';

const log = createLogger('ContentPrefs');

// ============================================================================
// CORE — GET / SET
// ============================================================================

async function getContentPref(
  contentType: string,
  identifier: string,
  key: string
): Promise<string | null> {
  try {
    const db = await getDatabase();
    const rows = await db.select<{ value: string }[]>(
      'SELECT value FROM content_preferences WHERE content_type = ? AND identifier = ? AND key = ?',
      [contentType, identifier, key]
    );
    return rows.length > 0 ? rows[0].value : null;
  } catch (error) {
    log.error(`Failed to read ${contentType}/${identifier}/${key}:`, error);
    return null;
  }
}

async function setContentPref(
  contentType: string,
  identifier: string,
  key: string,
  value: string
): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO content_preferences (content_type, identifier, key, value, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(content_type, identifier, key)
       DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [contentType, identifier, key, value, Date.now()]
    );
  } catch (error) {
    log.error(`Failed to save ${contentType}/${identifier}/${key}:`, error);
  }
}

// ============================================================================
// API — SOURCE PRÉFÉRÉE
// ============================================================================

/**
 * Récupère l'ID de la source préférée pour un contenu groupé par TMDB.
 * @returns stream_id (movie) ou series_id (series), ou null si aucune préférence
 */
export async function getPreferredSource(
  contentType: 'movie' | 'series',
  tmdbId: number
): Promise<number | null> {
  const raw = await getContentPref(contentType, String(tmdbId), 'preferred_source');
  if (raw === null) return null;
  const num = Number(raw);
  return isNaN(num) ? null : num;
}

/**
 * Sauvegarde la source préférée.
 */
export async function setPreferredSource(
  contentType: 'movie' | 'series',
  tmdbId: number,
  sourceId: number
): Promise<void> {
  await setContentPref(contentType, String(tmdbId), 'preferred_source', String(sourceId));
}

// ============================================================================
// API — DERNIÈRE SAISON CONSULTÉE
// ============================================================================

/**
 * Récupère la dernière saison consultée pour une série.
 * @param identifier - "tmdb_{id}" si tmdb disponible, sinon "{series_id}"
 */
export async function getLastSeason(identifier: string): Promise<number | null> {
  const raw = await getContentPref('series', identifier, 'last_season');
  if (raw === null) return null;
  const num = Number(raw);
  return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Sauvegarde la dernière saison consultée.
 */
export async function setLastSeason(identifier: string, season: number): Promise<void> {
  await setContentPref('series', identifier, 'last_season', String(season));
}

// ============================================================================
// API — VITESSE DE LECTURE
// ============================================================================

/**
 * Récupère la vitesse de lecture sauvegardée.
 * @param contentKey - stream_id (identifiant source Xtream)
 */
export async function getPlaybackSpeed(contentKey: string): Promise<number | null> {
  const raw = await getContentPref('player', contentKey, 'playback_speed');
  if (raw === null) return null;
  const num = parseFloat(raw);
  return isNaN(num) || num <= 0 ? null : num;
}

/**
 * Sauvegarde la vitesse de lecture.
 */
export async function setPlaybackSpeed(contentKey: string, speed: number): Promise<void> {
  await setContentPref('player', contentKey, 'playback_speed', String(speed));
}

// ============================================================================
// API — PISTES AUDIO / SOUS-TITRES
// ============================================================================

interface TrackPref {
  lang?: string;
  title?: string;
}

interface SavedTracks {
  preferredAudio?: TrackPref | null;
  preferredSub?: TrackPref | null;
  subDisabled?: boolean;
  aid?: number;
  sid?: number;
}

/**
 * Clé des pistes choisies pour toute une série, à côté de celles d'un épisode (stream_id).
 * Préfixe : pas de collision avec un stream_id, toujours numérique.
 */
export function seriesTracksKey(seriesId: number): string {
  return `series-${seriesId}`;
}

/**
 * Récupère les pistes audio/sub sauvegardées.
 */
export async function getSavedTracks(contentKey: string): Promise<SavedTracks | null> {
  const raw = await getContentPref('player', contentKey, 'audio_sub_tracks');
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SavedTracks;
  } catch {
    return null;
  }
}

/**
 * Sauvegarde la préférence audio pour un contenu.
 * Merge avec les prefs existantes (ne touche pas aux sub).
 */
export async function saveAudioPreference(
  contentKey: string,
  pref: TrackPref | null
): Promise<void> {
  const existing = await getSavedTracks(contentKey) || {};
  existing.preferredAudio = pref;
  await setContentPref('player', contentKey, 'audio_sub_tracks', JSON.stringify(existing));
}

/**
 * Sauvegarde la préférence sous-titres pour un contenu.
 * Merge avec les prefs existantes (ne touche pas à l'audio).
 */
export async function saveSubPreference(
  contentKey: string,
  pref: TrackPref | null,
  disabled: boolean
): Promise<void> {
  const existing = await getSavedTracks(contentKey) || {};
  existing.preferredSub = pref;
  existing.subDisabled = disabled;
  await setContentPref('player', contentKey, 'audio_sub_tracks', JSON.stringify(existing));
}


