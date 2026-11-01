/**
 * usePlayerActions.ts — Handlers MPV pour le Player
 *
 * Encapsule les 8 actions utilisateur du player :
 * togglePlayPause, handleSeek, handleVolumeChange, toggleMute,
 * toggleFullscreen, toggleAspect, skip, handleClose.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { setProperty, getProperty, command } from '../services/player/mpvApi';
import { mpvStop } from '../services/mpvBridge';
import {
  setFullscreen as setAndroidFullscreen,
  observeProperties as observeAndroidProperties,
} from '../services/player/androidPlayer';
import { isAndroid } from '../utils/platform';
import type { useMpvObserver } from './useMpvObserver';
import { warnOnReject } from '../utils/warnOnReject';
import { createLogger } from '../utils/logger';

const log = createLogger('PlayerControls');
const volumeLog = createLogger('Volume');

// ============================================================================
// TYPES
// ============================================================================

type MpvState = ReturnType<typeof useMpvObserver>;

interface PlayerActionsParams {
  mpv: MpvState;
  prefs: { savePlaybackPosition: () => Promise<void> | undefined };
  onClose: () => void;
  progressRef: React.RefObject<HTMLDivElement>;
}

/** Attente maximale de l'enregistrement de la position à la fermeture du lecteur */
export const SAVE_ON_CLOSE_TIMEOUT_MS = 2000;

/** Mode d'affichage vidéo : Fit (letterbox), Fill (crop), Stretch (étire) */
export type AspectMode = 'fit' | 'fill' | 'stretch';

interface PlayerActionsReturn {
  togglePlayPause: () => Promise<void>;
  handleSeek: (e: React.MouseEvent<HTMLDivElement>) => Promise<void>;
  handleVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleFullscreen: () => Promise<void>;
  toggleAspect: () => Promise<void>;
  skip: (seconds: number) => Promise<void>;
  handleClose: () => Promise<void>;
  isFullscreen: boolean;
  aspectMode: AspectMode;
}

// ============================================================================
// HOOK
// ============================================================================

export function usePlayerActions({ mpv, prefs, onClose, progressRef }: PlayerActionsParams): PlayerActionsReturn {
  // Android : PlayerContext passe le lecteur en plein écran immersif dès le lancement
  const [isFullscreen, setIsFullscreen] = useState(() => isAndroid());
  const [aspectMode, setAspectMode] = useState<AspectMode>('fit');
  const aspectModeRef = useRef<AspectMode>('fit');
  // Refs stables de useMpvObserver, sorties de `mpv` : la règle react-hooks/immutability interdit d'écrire dans un argument du hook
  const { seekTimeoutRef, timePosUpdatesRef, volumeRef, setCurrentTime, setIsSeeking } = mpv;

  // Sync ref avec state pour accès dans les listeners
  useEffect(() => { aspectModeRef.current = aspectMode; }, [aspectMode]);

  // Android : le plein écran change aussi hors de ce hook (PlayerContext à chaque play/zapping,
  // retour au premier plan, stop) → suivre la propriété native pour garder le bouton cohérent
  useEffect(() => {
    if (!isAndroid()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    observeAndroidProperties(['fullscreen'], (event) => setIsFullscreen(Boolean(event.data)))
      .then((fn) => { if (disposed) fn(); else unlisten = fn; })
      .catch((e) => log.warn('fullscreen observer failed:', e));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  // Recalculer video-aspect-override lors des resize quand en mode stretch
  // (Android : le mode "stretch" natif suit la taille de la vue, rien à recalculer)
  useEffect(() => {
    if (isAndroid()) return;
    const win = getCurrentWindow();
    const applyStretch = async () => {
      if (aspectModeRef.current !== 'stretch') return;
      try {
        const size = await win.innerSize();
        const ratio = size.width / size.height;
        await setProperty('video-aspect-override', String(ratio));
      } catch (_) { /* ignore */ }
    };
    const unlisten = win.onResized(() => { void applyStretch(); });
    return () => { unlisten.then(fn => fn()).catch(warnOnReject('PlayerActions')); };
  }, []);

  const togglePlayPause = useCallback(async () => {
    const newState = !mpv.isPaused;
    try {
      await setProperty('pause', newState);
    } catch (e) {
      log.error('Failed to toggle pause:', e);
    }
  }, [mpv.isPaused]);

  const handleSeek = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || mpv.duration === 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const percent = Math.max(0, Math.min(100, (x / width) * 100));
    const newTime = (percent / 100) * mpv.duration;

    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);

    setCurrentTime(newTime);
    setIsSeeking(true);

    try {
      await command('seek', [String(newTime), 'absolute']);
    } catch (e) {
      log.error('Seek failed', e);
      setIsSeeking(false);
      return;
    }

    timePosUpdatesRef.current = 0;
    seekTimeoutRef.current = setTimeout(() => {
      setIsSeeking(false);
    }, 10000);
    // Refs et fonctions stables (seekTimeoutRef, timePosUpdatesRef, setCurrentTime, setIsSeeking) : seule la durée (et progressRef) refait la fonction
  }, [mpv.duration, progressRef, seekTimeoutRef, timePosUpdatesRef, setCurrentTime, setIsSeeking]);

  const handleVolumeChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(e.target.value);
    volumeRef.current = newVolume;
    await setProperty('volume', newVolume);
    // Changer le volume (au-dessus de 0) rétablit toujours le son, même si l'affichage le croyait actif
    if (newVolume > 0) {
      mpv.setIsMuted(false);
      await setProperty('mute', false);
    }
    // volumeRef et setIsMuted sont stables
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- uniquement une ref et un setter stables de useMpvObserver

  const toggleMute = useCallback(async () => {
    try {
      // État lu dans mpv : basculer depuis un affichage en retard renvoyait la valeur déjà en place
      const current = await getProperty('mute').catch(() => null);
      const next = !(typeof current === 'boolean' ? current : mpv.isMuted);
      await setProperty('mute', next);
      mpv.setIsMuted(next);
    } catch (e) {
      volumeLog.error('Failed to toggle mute:', e);
    }
  }, [mpv.isMuted]); // eslint-disable-line react-hooks/exhaustive-deps -- setIsMuted est un setter stable

  const toggleFullscreen = useCallback(async () => {
    if (isAndroid()) {
      const next = !isFullscreen;
      try {
        await setAndroidFullscreen(next);
        setIsFullscreen(next);
      } catch (e) {
        log.error('Fullscreen error:', e);
      }
      return;
    }
    const window = getCurrentWindow();
    try {
      const current = await window.isFullscreen();
      await window.setFullscreen(!current);
      setIsFullscreen(!current);
    } catch (e) {
      log.error('Fullscreen error:', e);
    }
  }, [isFullscreen]);

  const toggleAspect = useCallback(async () => {
    // Cycle : fit → fill → stretch → fit
    const nextMode: AspectMode = aspectMode === 'fit' ? 'fill' : aspectMode === 'fill' ? 'stretch' : 'fit';
    try {
      switch (nextMode) {
        case 'fit':
          await setProperty('panscan', 0);
          await setProperty('video-aspect-override', '-1'); // Reset to original
          break;
        case 'fill':
          await setProperty('video-aspect-override', '-1'); // Reset first
          await setProperty('panscan', 1);
          break;
        case 'stretch': {
          // Étirer = forcer le ratio fenêtre sur la vidéo
          // Appliquer l'override AVANT de couper panscan pour éviter un flash Fit
          let windowRatio = window.innerWidth / window.innerHeight;
          if (!isAndroid()) {
            const size = await getCurrentWindow().innerSize();
            windowRatio = size.width / size.height;
          }
          await setProperty('video-aspect-override', String(windowRatio));
          await setProperty('panscan', 0);
          break;
        }
      }
      setAspectMode(nextMode);
    } catch (e) {
      log.error('Aspect toggle error:', e);
    }
  }, [aspectMode]);

  const skip = useCallback(async (seconds: number) => {
    // Valeurs exactes lues dans les refs : la fonction ne change plus à chaque tic de lecture, et
    // l'écouteur clavier n'est plus détaché puis rattaché 4 à 60 fois par seconde
    const newTime = Math.max(0, Math.min(mpv.durationRef.current, mpv.currentTimeRef.current + seconds));
    mpv.setCurrentTime(newTime);
    mpv.setIsSeeking(true);
    timePosUpdatesRef.current = 0;

    try {
      await command('seek', [String(seconds), 'relative']);
    } catch (e) {
      log.error('Skip failed:', e);
      mpv.setIsSeeking(false);
    }
    // Refs et setters (currentTimeRef, durationRef, timePosUpdatesRef, setCurrentTime, setIsSeeking) sont stables
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- uniquement des refs et setters stables de useMpvObserver

  const handleClose = useCallback(async () => {
    // Position enregistrée AVANT de rendre la main : l'app peut être fermée juste après.
    // Écriture locale (SQLite) ; plafonnée pour ne jamais bloquer la fermeture du lecteur.
    const saved = Promise.resolve()
      .then(() => prefs.savePlaybackPosition())
      .catch((e) => log.warn('Failed to save position:', e));

    // Reset aspect ratio to Fit before closing
    try {
      await setProperty('panscan', 0);
      await setProperty('video-aspect-override', '-1');
    } catch (_) { /* ignore */ }

    // Coupe l'image et le son tout de suite ; PlayerContext.stop ne renverra pas un second « stop »
    try { await mpvStop(); } catch (e) {
      log.warn('Failed to stop MPV:', e);
    }

    // Après l'arrêt (pas de son rejoué) : mpv garde la sourdine d'une lecture à l'autre,
    // chaque nouvelle lecture repart donc avec le son
    try { await setProperty('mute', false); } catch (_) { /* ignore */ }

    const exitFullscreen = async () => {
      // Android : la commande stop du plugin restaure déjà barres système et orientation
      if (isAndroid()) return;
      try {
        const win = getCurrentWindow();
        const isFs = await win.isFullscreen();
        if (isFs) {
          await win.setFullscreen(false);
          setIsFullscreen(false);
        }
      } catch (e) {
        log.warn('Could not exit fullscreen:', e);
      }
    };

    await Promise.race([exitFullscreen(), new Promise(r => setTimeout(r, 500))]);
    await Promise.race([saved, new Promise(r => setTimeout(r, SAVE_ON_CLOSE_TIMEOUT_MS))]);
    onClose();
  }, [prefs, onClose]);

  return {
    togglePlayPause, handleSeek, handleVolumeChange,
    toggleMute, toggleFullscreen, toggleAspect, skip, handleClose,
    isFullscreen, aspectMode,
  };
}
