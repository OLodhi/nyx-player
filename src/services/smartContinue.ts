/**
 * smartContinue.ts — Logique du carrousel "Reprendre la lecture"
 *
 * Responsabilités :
 * - getContinueWatching : récupérer les items pour le carrousel Dashboard
 * - Déduplication robuste par series_id, tmdb_id, et titre
 * - Smart Continue : afficher l'épisode suivant si le précédent est terminé
 */

import { getDatabase } from './dbCore';
import tmdb from './tmdbApi';

// ============================================================================
// TYPES
// ============================================================================

import type { PlaybackProgressRow } from '../types/playbackProgress';
import { createLogger } from '../utils/logger';

const log = createLogger('SmartContinue');

/** Reprise lue avec le titre et l'affiche de sa fiche TMDB en cache (série pour un épisode) */
interface ContinueWatchingRow extends PlaybackProgressRow {
  tmdb_title: string | null;
  tmdb_poster_path: string | null;
}

/** Item pour le carrousel "Reprendre la lecture" */
export interface PlaybackProgressItem {
  id: number; // stream_id
  type: 'movie' | 'series';
  title: string;
  image: string;
  progress: number; // 0-100
  lastWatched: number; // timestamp
  tmdbId: number | null;
  // Pour lecture directe ("Reprendre la lecture")
  timeSeconds: number; // Position en secondes pour seek
  containerExtension?: string; // Extension vidéo (mp4, mkv, etc.)
  // Pour épisodes
  episodeInfo?: {
    seasonNumber: number;
    episodeNumber: number;
    episodeId: string;
    isNextEpisode?: boolean;
  };
  // Pour navigation
  seriesId?: number;
}

// ============================================================================
// GET CONTINUE WATCHING
// ============================================================================

/**
 * Récupère les items pour le carousel "Reprendre la lecture".
 * 
 * Logique:
 * - Films: 2-95% de progression, dédup par TMDB
 * - Séries: 2-95% progression OU Smart Continue (épisode suivant disponible)
 * - Trié par updated_at DESC
 * - Limite 30 items
 */
export async function getContinueWatching(): Promise<PlaybackProgressItem[]> {
  const db = await getDatabase();
  
  try {
    // Requête pour récupérer les progressions éligibles
    // On filtre côté JS pour le Smart Continue (plus simple)
    // Titre et affiche de la fiche TMDB en cache d'abord : un titre enregistré sous le nom brut du
    // fournisseur (lecture depuis la recherche, reçu d'un autre appareil) reprend son titre officiel
    // dès que la fiche est connue. Au plus une fiche par reprise (clé primaire).
    const rows = await db.select<ContinueWatchingRow[]>(
      `SELECT p.*, t.display_name AS tmdb_title, t.poster_path AS tmdb_poster_path
       FROM playback_progress p
       LEFT JOIN tmdb_details_cache t
         ON p.tmdb_id > 0
         AND t.tmdb_id = p.tmdb_id
         AND t.type = CASE WHEN p.content_type = 'movie' THEN 'movie' ELSE 'series' END
         AND t.season_number = 0
       ORDER BY p.updated_at DESC
       LIMIT 100`
    );
    
    const results: PlaybackProgressItem[] = [];
    const seenTmdb = new Map<string, PlaybackProgressItem>(); // Pour dédup
    
    for (const row of rows) {
      // Affiche officielle (fiche TMDB en cache) d'abord, sinon celle enregistrée
      const rowImage = (row.tmdb_poster_path ? tmdb.imageUrl(row.tmdb_poster_path, 'w342') : null) || row.poster_url || '';
      const progressPercent = row.duration_seconds > 0
        ? (row.time_seconds / row.duration_seconds) * 100
        : 0;
      
      // Logique de filtrage
      let shouldInclude = false;
      let isNextEpisode = false;
      let displayStreamId = row.stream_id;
      let displaySeason = row.season_number;
      let displayEpisode = row.episode_number;
      
      if (row.content_type === 'movie') {
        // Films: progression entre 2% et 95%
        shouldInclude = progressPercent >= 2 && progressPercent <= 95;
      } else {
        // Épisodes: logique Smart Continue
        if (progressPercent >= 2 && progressPercent <= 95) {
          // Épisode en cours
          shouldInclude = true;
        } else if (progressPercent > 95 && row.next_episode_id) {
          // Épisode terminé avec suivant disponible = Smart Continue
          const nextId = Number(row.next_episode_id);
          // Validation: skip si next_episode_id n'est pas un nombre valide
          if (isNaN(nextId) || nextId <= 0) continue;
          
          shouldInclude = true;
          isNextEpisode = true;
          displayStreamId = nextId;
          displaySeason = row.next_season;
          displayEpisode = row.next_episode_number;
        }
        // Si terminé sans next episode = pas affiché
      }
      
      if (!shouldInclude) continue;
      
      // Déduplication robuste :
      // - Épisodes: par series_id (primary, toujours fiable) + tmdb_id (secondary, multi-source)
      // - Films: par tmdb_id (ou stream_id si pas de TMDB)
      // 
      // BUG FIX: l'ancienne logique utilisait tmdb_id comme clé primaire pour les épisodes,
      // mais tmdb_id peut être 0 pour certaines entrées (ex: épisode lancé via navigation
      // suivant/précédent sans propagation de PlayOptions). Résultat: 2 entrées pour la
      // même série avec des clés différentes → carte fantôme dans le carrousel.
      let dedupeKey: string;
      
      if (row.content_type === 'episode') {
        // Clé primaire: series_id (toujours présent et stable pour une source donnée)
        const seriesKey = row.series_id ? `series_${row.series_id}` : null;
        // Clé secondaire: tmdb_id (pour dédupliquer les séries multi-sources)
        const tmdbKey = (row.tmdb_id && row.tmdb_id > 0) ? `series_tmdb_${row.tmdb_id}` : null;
        // Clé tertiaire: titre normalisé (safety net quand series_id et tmdb_id sont absents)
        const titleKey = row.title ? `title_${row.title.replace(/\s*S\d+E\d+.*$/i, '').trim().toLowerCase()}` : null;
        
        // Vérifier si déjà vu via l'une ou l'autre clé
        if ((seriesKey && seenTmdb.has(seriesKey)) || (tmdbKey && seenTmdb.has(tmdbKey)) || (titleKey && seenTmdb.has(titleKey))) {
          const existing = seenTmdb.get(seriesKey!) || seenTmdb.get(tmdbKey!) || seenTmdb.get(titleKey!);
          if (existing && !existing.image && rowImage) {
            existing.image = rowImage;
          }
          continue;
        }
        
        dedupeKey = seriesKey || tmdbKey || `stream_${row.stream_id}`;
      } else if (row.tmdb_id && row.tmdb_id > 0) {
        dedupeKey = `${row.content_type}_${row.tmdb_id}`;
      } else {
        dedupeKey = `stream_${row.stream_id}`;
      }
      
      // Garder seulement le plus récent par clé de dédup
      if (seenTmdb.has(dedupeKey)) {
        const existing = seenTmdb.get(dedupeKey)!;
        if (!existing.image && rowImage) {
          existing.image = rowImage;
        }
        continue;
      }
      
      const item: PlaybackProgressItem = {
        id: displayStreamId,
        type: row.content_type === 'movie' ? 'movie' : 'series',
        title: row.tmdb_title || row.title,
        image: rowImage,
        progress: isNextEpisode ? 0 : Math.round(progressPercent),
        lastWatched: row.updated_at,
        tmdbId: row.tmdb_id,
        timeSeconds: isNextEpisode ? 0 : row.time_seconds, // Pour seek lors de lecture directe
        containerExtension: row.container_extension || undefined,
      };
      
      // Ajouter episodeInfo pour les séries
      if (row.content_type === 'episode') {
        // Smart Continue: si next_season est null/0, fallback sur season_number de la row
        const resolvedSeason = displaySeason || row.season_number || undefined;
        item.episodeInfo = {
          seasonNumber: resolvedSeason ?? 0,
          episodeNumber: displayEpisode ?? 0,
          episodeId: isNextEpisode ? row.next_episode_id! : String(row.stream_id),
          isNextEpisode,
        };
        item.seriesId = row.series_id ?? undefined;
      }
      
      seenTmdb.set(dedupeKey, item);
      
      // Enregistrer les clés secondaires pour cross-dédup épisodes
      if (row.content_type === 'episode') {
        const seriesKey = row.series_id ? `series_${row.series_id}` : null;
        const tmdbKey = (row.tmdb_id && row.tmdb_id > 0) ? `series_tmdb_${row.tmdb_id}` : null;
        const titleKey = row.title ? `title_${row.title.replace(/\s*S\d+E\d+.*$/i, '').trim().toLowerCase()}` : null;
        if (seriesKey && seriesKey !== dedupeKey) seenTmdb.set(seriesKey, item);
        if (tmdbKey && tmdbKey !== dedupeKey) seenTmdb.set(tmdbKey, item);
        if (titleKey && titleKey !== dedupeKey) seenTmdb.set(titleKey, item);
      }
      
      results.push(item);
      
      // Limite
      if (results.length >= 30) break;
    }
    
    return results;
    
  } catch (error) {
    log.error('getContinueWatching error:', error);
    return [];
  }
}
