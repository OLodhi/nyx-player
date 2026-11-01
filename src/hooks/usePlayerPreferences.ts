/**
 * usePlayerPreferences.ts — Restauration et persistence des préférences lecteur
 *
 * Gère :
 * - Chargement des tracks MPV (audio/sub) avec retry
 * - Restauration de la vitesse, tracks, et position depuis SQLite
 * - Handlers pour changer speed/tracks/subtitle scale avec persistence
 * - Sauvegarde de position (utilisé par handleClose et handleNextEpisode)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getProperty, setProperty, command } from '../services/player/mpvApi';
import { getLoadSequence } from '../services/mpvBridge';
import {
  getSubtitleScale, setSubtitleScale as saveSubtitleScale,
} from '../services/preferencesService';
import {
  finalizePlayback, getProgressByStreamId,
} from '../services/playbackProgressService';
import {
  getPlaybackSpeed, setPlaybackSpeed as savePlaybackSpeed,
  getSavedTracks, saveAudioPreference, saveSubPreference, seriesTracksKey,
} from '../services/contentPreferencesService';
import type { Track, SeriesMetadata } from '../types/player';
import i18next from 'i18next';
import { pickTrackForLanguage } from '../utils/trackLanguage';
import { createLogger } from '../utils/logger';

const log = createLogger('usePlayerPreferences');

// ============================================================================
// TYPES
// ============================================================================

interface PlayerPreferencesState {
  audioTracks: Track[];
  subTracks: Track[];
  subtitleScale: number;
  changeSpeed: (speed: number) => Promise<void>;
  changeSubtitleScale: (scale: number) => Promise<void>;
  selectAudioTrack: (trackId: number) => Promise<void>;
  selectSubTrack: (trackId: number) => Promise<void>;
  savePlaybackPosition: () => Promise<void> | undefined;
}

/**
 * Aucun choix mémorisé pour ce contenu : mpv prendrait la première piste du fichier
 * (souvent une langue au hasard sur les fichiers multi-langues). On suit la langue de l'app,
 * et à défaut d'audio dans cette langue, on active les sous-titres correspondants.
 */
async function applyLanguageDefaults(audio: Track[], subs: Track[]): Promise<void> {
  const language = (i18next.resolvedLanguage || i18next.language || 'fr').slice(0, 2);

  const audioMatch = pickTrackForLanguage(audio, language);
  if (audioMatch) {
    if (!audioMatch.selected) await setProperty('aid', audioMatch.id);
    return;
  }

  const subMatch = pickTrackForLanguage(subs, language);
  if (subMatch) await setProperty('sid', subMatch.id);
}

/**
 * Écart toléré (s) entre la position à l'ouverture et la position enregistrée : en deçà, le flux a
 * déjà été ouvert au bon endroit et aucun saut n'est fait.
 */
export const RESUME_TOLERANCE_S = 15;

/**
 * Attente après un changement de la liste des pistes avant de la relire : mpv la modifie plusieurs
 * fois de suite à l'ouverture d'un flux (et à chaque variante d'un flux HLS).
 */
export const TRACK_LIST_SETTLE_MS = 300;

/** Pistes identiques d'une lecture à l'autre (la piste sélectionnée ne compte pas) */
const trackSignature = (tracks: Track[]): string =>
  tracks.map((t) => `${t.type}:${t.id}:${t.lang ?? ''}:${t.title ?? ''}`).join('|');

// ============================================================================
// HOOK
// ============================================================================

export function usePlayerPreferences(
  isConnected: boolean,
  contentId: string | undefined,
  tmdbId: number | undefined,
  duration: number,
  currentTime: number,
  seriesMetadata: SeriesMetadata | undefined,
  syncFromMpv: () => Promise<void>,
  setIsSeeking: (v: boolean) => void,
  /** Changements de la liste des pistes (useMpvObserver) : seul signal de pistes prêtes sur un direct */
  trackListRevision = 0,
): PlayerPreferencesState {
  const [audioTracks, setAudioTracks] = useState<Track[]>([]);
  const [subTracks, setSubTracks] = useState<Track[]>([]);
  const [subtitleScale, setSubtitleScale] = useState(() => getSubtitleScale());
  const durationRef = useRef(duration);
  useEffect(() => { durationRef.current = duration; });

  /**
   * Choix de pistes d'une série : un choix fait sur un épisode vaut pour les suivants. Sans lui,
   * l'épisode suivant prenait la langue de l'app et perdait les sous-titres choisis à la main.
   */
  const seriesKey = seriesMetadata ? seriesTracksKey(seriesMetadata.seriesId) : undefined;

  /** Chargement, contenu et pistes auxquels les choix mémorisés ont déjà été appliqués */
  const appliedKeyRef = useRef<string | null>(null);

  // ---- Fetch tracks & restore preferences ----
  const fetchTracks = useCallback(async () => {
    // Zap ou relance pendant la lecture des pistes et des choix mémorisés (SQLite) : les choix de ce
    // contenu ne doivent pas tomber sur le chargement suivant (piste absente = chaîne muette)
    const sequence = getLoadSequence();
    const superseded = () => getLoadSequence() !== sequence;
    try {
      const trackList = (await getProperty('track-list')) as Track[] | null;
      if (superseded()) return;
      if (!trackList || !Array.isArray(trackList)) {
        return;
      }

      const audio = trackList.filter((t) => t.type === 'audio');
      const subs = trackList.filter((t) => t.type === 'sub');

      // Skip if empty — MPV may not have parsed the file yet
      if (audio.length === 0) {
        return;
      }

      setAudioTracks(audio);
      setSubTracks(subs);

      // Choix déjà appliqués à ces pistes pour ce chargement : seuls les menus sont rafraîchis. Sans ça,
      // chaque changement de la liste (variantes HLS) réappliquerait vitesse et pistes. Une relance du
      // même contenu est un nouveau chargement (mpv y a remis les pistes par défaut) : choix réappliqués.
      // La série compte aussi : lancé depuis « Continuer à regarder », l'épisode ne la connaît qu'après
      // coup (infos lues chez le fournisseur), et son choix doit alors être appliqué.
      const appliedKey = `${sequence}#${contentId ?? ''}#${seriesKey ?? ''}#${trackSignature(trackList)}`;
      if (appliedKeyRef.current === appliedKey) {
        await syncFromMpv();
        return true;
      }
      appliedKeyRef.current = appliedKey;

      // ---- Restore saved preferences ----

      // Speed: restore from SQLite (keyed by source/stream_id)
      let speedRestored = false;
      const speedKey = contentId;
      if (speedKey) {
        const savedSpeed = await getPlaybackSpeed(speedKey);
        if (superseded()) return;
        if (savedSpeed !== null && savedSpeed > 0 && savedSpeed !== 1.0) {
          await setProperty('speed', savedSpeed);
          speedRestored = true;
        }
      }

      // Audio/Subtitle tracks: restore from SQLite. Épisode : le choix fait pour la série, complété
      // ou remplacé par celui fait sur cet épisode précis.
      const trackKey = contentId;
      if (trackKey) {
        const episodeTracks = await getSavedTracks(trackKey);
        const seriesTracks = seriesKey ? await getSavedTracks(seriesKey) : null;
        if (superseded()) return;
        const savedTracksRaw = episodeTracks || seriesTracks ? { ...seriesTracks, ...episodeTracks } : null;
        const savedTracks = savedTracksRaw ? JSON.stringify(savedTracksRaw) : null;
        if (savedTracks) {
          try {
            const { preferredAudio, preferredSub, subDisabled, aid, sid } = JSON.parse(savedTracks);

            // Helper: find best matching track
            const findBestMatch = (tracks: Track[], pref?: { lang?: string; title?: string }): Track | undefined => {
              if (!pref) return undefined;
              if (pref.lang && pref.title) {
                const exact = tracks.find(t => t.lang === pref.lang && t.title === pref.title);
                if (exact) return exact;
              }
              if (pref.lang) {
                const byLang = tracks.find(t => t.lang === pref.lang);
                if (byLang) return byLang;
              }
              if (pref.title) {
                const byTitle = tracks.find(t => t.title === pref.title);
                if (byTitle) return byTitle;
              }
              return undefined;
            };

            // Restore audio track
            if (preferredAudio) {
              const matchedAudio = findBestMatch(audio, preferredAudio);
              if (matchedAudio) {
                await setProperty('aid', matchedAudio.id);
              } else if (audio.length > 0) {
                await setProperty('aid', audio[0].id);
              }
            } else if (typeof aid === 'number' && aid > 0) {
              await setProperty('aid', aid);
            }

            // Restore subtitle track
            if (subDisabled === true) {
              await setProperty('sid', 0);
            } else if (preferredSub) {
              const matchedSub = findBestMatch(subs, preferredSub);
              if (matchedSub) {
                await setProperty('sid', matchedSub.id);
              } else {
                await setProperty('sid', 0);
              }
            } else if (typeof sid === 'number') {
              await setProperty('sid', sid);
            }
          } catch (e) {
            log.error('Failed to parse saved tracks:', e);
          }
        } else {
          await applyLanguageDefaults(audio, subs);
        }
      } else {
        await applyLanguageDefaults(audio, subs);
      }

      // If no saved speed, reset to 1.0
      if (!speedRestored) {
        await setProperty('speed', 1.0);
      }

      // Re-sync observer state with actual MPV values
      await syncFromMpv();

      return true; // Tracks found
    } catch (e) {
      log.error('Failed to fetch tracks:', e);
      return false;
    }
    // tmdbId n'est pas lu : gardé pour rafraîchir les menus de pistes quand la fiche TMDB du même flux change
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dépendance voulue, voir ci-dessus
  }, [tmdbId, contentId, seriesKey, syncFromMpv]);

  // Fetch tracks when duration becomes available (= MPV has parsed file metadata)
  const hasDuration = duration > 0;
  useEffect(() => {
    if (!isConnected || !hasDuration) return;

    let cancelled = false;

    // First fetch immediately — tracks should be available now
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pistes lues dans mpv (asynchrone) : l'état n'est modifié qu'après réponse
    void fetchTracks();

    // One retry 5s later to catch late-arriving tracks (subs)
    const retryTimer = setTimeout(() => {
      if (!cancelled) void fetchTracks();
    }, 5000);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [isConnected, hasDuration, fetchTracks]); // hasDuration : une seule fois, quand mpv a lu les métadonnées

  // Liste des pistes modifiée (nouveau flux, sous-titres arrivés tard) : c'est le seul signal sur un
  // direct, dont la durée reste à 0. Sans lui, menu audio et sous-titres vide et langues préférées
  // jamais appliquées en Live TV. Relu aussi quand le contenu change (zap).
  const fetchTracksRef = useRef(fetchTracks);
  useEffect(() => { fetchTracksRef.current = fetchTracks; });
  useEffect(() => {
    // Révision 0 : lecture au montage et à chaque contenu, la liste a pu être complète avant que
    // l'écoute soit branchée (mpv.exe ne renvoie pas la valeur initiale d'une propriété observée)
    if (!isConnected) return;
    const timer = setTimeout(() => { void fetchTracksRef.current(); }, TRACK_LIST_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isConnected, trackListRevision, contentId]);

  // Restore position from SQLite when duration becomes available.
  // Une seule fois par contenu : mpv affine la durée en cours de lecture, et chaque nouvelle valeur
  // ramenait à la position enregistrée alors que l'utilisateur s'était déplacé.
  const restoredContentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contentId || !isConnected || !hasDuration) return;
    if (restoredContentRef.current === contentId) return;
    restoredContentRef.current = contentId;

    getProgressByStreamId(Number(contentId)).then(async (saved) => {
      if (!saved) return;

      if (saved.timeSeconds > 10) {
        // Smart Reset: content already watched → start from beginning
        if (saved.progressPercent >= 95) {
          return;
        }

        // Normal restore
        if (saved.timeSeconds < durationRef.current - 30) {
          // Flux déjà ouvert à cette position (PlayerContext la passe au chargement) :
          // pas de second saut, qui rouvrirait une connexion au fournisseur
          const position = await getProperty('time-pos').catch(() => null);
          if (typeof position === 'number' && Math.abs(position - saved.timeSeconds) <= RESUME_TOLERANCE_S) return;

          setIsSeeking(true);
          command('seek', [String(saved.timeSeconds), 'absolute'])
            .catch((e) => {
              log.error('Failed to restore position:', e);
              setIsSeeking(false);
            });
        }
      }
    }).catch((e) => {
      log.error('Failed to get progress from SQLite:', e);
    });
  }, [contentId, isConnected, hasDuration]); // eslint-disable-line react-hooks/exhaustive-deps -- setIsSeeking stable, durée lue dans durationRef : une seule restauration par contenu

  // Apply subtitle scale on connect
  useEffect(() => {
    if (!isConnected) return;
    const timer = setTimeout(() => {
      setProperty('sub-scale', subtitleScale).catch((e) => log.error('Failed to set subtitle scale:', e));
    }, 500);
    return () => clearTimeout(timer);
  }, [isConnected]); // eslint-disable-line react-hooks/exhaustive-deps -- à la connexion du lecteur seulement ; un changement d'échelle passe par changeSubtitleScale

  // ---- Change handlers ----
  const changeSpeed = useCallback(async (speed: number) => {
    const speedKey = contentId;
    if (speedKey) {
      void savePlaybackSpeed(speedKey, speed);
    }
    try {
      await setProperty('speed', speed);
    } catch (e) {
      log.error('Speed change failed:', e);
    }
  }, [contentId]);

  const changeSubtitleScale = useCallback(async (scale: number) => {
    setSubtitleScale(scale);
    void saveSubtitleScale(scale);
    try {
      await setProperty('sub-scale', scale);
    } catch (e) {
      log.error('Subtitle scale change failed:', e);
    }
  }, []);

  const selectAudioTrack = useCallback(async (trackId: number) => {
    await setProperty('aid', trackId);
    const trackKey = contentId;
    if (trackKey) {
      const selectedTrack = audioTracks.find(t => t.id === trackId);
      const pref = selectedTrack ? { lang: selectedTrack.lang, title: selectedTrack.title } : null;
      void saveAudioPreference(trackKey, pref);
      if (seriesKey) void saveAudioPreference(seriesKey, pref);
    }
  }, [contentId, seriesKey, audioTracks]);

  const selectSubTrack = useCallback(async (trackId: number) => {
    await setProperty('sid', trackId);
    const trackKey = contentId;
    if (trackKey) {
      const selectedTrack = trackId === 0 ? null : subTracks.find(t => t.id === trackId);
      const pref = selectedTrack ? { lang: selectedTrack.lang, title: selectedTrack.title } : null;
      const disabled = trackId === 0;
      void saveSubPreference(trackKey, pref, disabled);
      if (seriesKey) void saveSubPreference(seriesKey, pref, disabled);
    }
  }, [contentId, seriesKey, subTracks]);

  // ---- Save position (called on close + episode navigation) ----
  const savePlaybackPosition = useCallback(() => {
    if (!contentId || duration === 0 || currentTime < 10) return;

    return finalizePlayback({
      streamId: Number(contentId),
      timeSeconds: currentTime,
      durationSeconds: duration,
      nextEpisode: seriesMetadata?.nextEpisode || null,
    }).catch((e) => {
      log.error('Failed to finalize:', e);
    });
  }, [contentId, currentTime, duration, seriesMetadata]);

  return {
    audioTracks, subTracks, subtitleScale,
    changeSpeed, changeSubtitleScale,
    selectAudioTrack, selectSubTrack,
    savePlaybackPosition,
  };
}
