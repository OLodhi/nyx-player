/**
 * usePlayerKeyboard.ts — Raccourcis clavier et contrôle molette du player
 *
 * Gère :
 * - Espace/K = play/pause (Espace capté avant l'élément focalisé, voir handleSpaceCapture)
 * - Flèches gauche/droite = seek ±10s
 * - Flèches haut/bas = volume ±5
 * - M = mute/unmute
 * - F = plein écran
 * - I = geek stats (si activé)
 * - Molette = volume (désactivée quand un menu popup est ouvert)
 *
 * Tout est bloqué quand le Smart Lock est actif.
 */

import { useEffect, useCallback, useRef } from 'react';
import { setProperty } from '../services/player/mpvApi';
import { isGeekStatsEnabled } from '../services/preferencesService';
import { isTv } from '../utils/platform';
import { createLogger } from '../utils/logger';

const log = createLogger('Volume');

// ============================================================================
// TYPES
// ============================================================================

interface PlayerKeyboardHandlers {
  togglePlayPause: () => void | Promise<void>;
  skip: (seconds: number) => void | Promise<void>;
  toggleMute: () => void | Promise<void>;
  toggleFullscreen: () => void | Promise<void>;
  setShowGeekStats: React.Dispatch<React.SetStateAction<boolean>>;
  onOverlayPlayPause?: () => void;
  /** Tactile : tap simple sur la vidéo (afficher/masquer les contrôles) */
  onTouchTap?: () => void;
}

interface PlayerKeyboardOptions {
  isLocked: boolean;
  showAudioSubMenu: boolean;
  showSpeedMenu: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  volumeRef: React.MutableRefObject<number>;
  setVolumeState: React.Dispatch<React.SetStateAction<number>>;
  setIsMuted: React.Dispatch<React.SetStateAction<boolean>>;
}

// ============================================================================
// HOOK
// ============================================================================

export function usePlayerKeyboard(
  handlers: PlayerKeyboardHandlers,
  options: PlayerKeyboardOptions,
): void {
  const {
    togglePlayPause, skip, toggleMute, toggleFullscreen, setShowGeekStats, onOverlayPlayPause, onTouchTap,
  } = handlers;

  const {
    isLocked, showAudioSubMenu, showSpeedMenu,
    containerRef, volumeRef, setVolumeState, setIsMuted,
  } = options;

  // Volume adjustment via scroll/keyboard — uses ref for stable reference
  const adjustVolume = useCallback((delta: number) => {
    const currentVol = volumeRef.current;
    const newVolume = Math.max(0, Math.min(100, currentVol + delta));

    volumeRef.current = newVolume;
    setVolumeState(newVolume);

    setProperty('volume', newVolume).catch((e) => log.error('Failed to set volume:', e));

    // Toujours envoyé : l'affichage peut croire le son actif alors que mpv l'a coupé
    if (newVolume > 0) {
      setIsMuted(false);
      setProperty('mute', false).catch((e) => log.error('Failed to unmute:', e));
    }
  }, [volumeRef, setVolumeState, setIsMuted]);

  // Keyboard shortcuts
  useEffect(() => {
    // TV : les flèches et OK suivent d'autres règles (usePlayerRemote)
    if (isTv()) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isLocked) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'k':
          e.preventDefault();
          void togglePlayPause();
          break;
        case 'arrowleft':
          e.preventDefault();
          void skip(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          void skip(10);
          break;
        case 'arrowup':
          e.preventDefault();
          adjustVolume(5);
          break;
        case 'arrowdown':
          e.preventDefault();
          adjustVolume(-5);
          break;
        case 'm':
          e.preventDefault();
          void toggleMute();
          break;
        case 'f':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case 'i':
          e.preventDefault();
          if (isGeekStatsEnabled()) {
            setShowGeekStats((prev) => !prev);
          }
          break;
      }
    };

    // Espace : capté avant l'élément focalisé et arrêté là. Après un clic sur une chaîne du menu
    // rapide (ou un épisode du sélecteur), la carte garde le focus ; sans cela, sa propre
    // validation par Espace (clickableProps) relançait la chaîne juste après la pause.
    const handleSpaceCapture = (e: KeyboardEvent) => {
      if (e.key !== ' ' || isLocked) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      e.stopPropagation();
      void togglePlayPause();
    };

    window.addEventListener('keydown', handleSpaceCapture, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleSpaceCapture, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLocked, togglePlayPause, skip, toggleMute, toggleFullscreen, setShowGeekStats, adjustVolume]);

  // Mouse wheel volume control
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (isLocked) return;
      if (showAudioSubMenu || showSpeedMenu) return;
      // Ne pas intercepter le scroll si la souris est au-dessus du menu TV (Sidebar / Grid) ou Switcher d'Épisodes
      const target = e.target as HTMLElement;
      if (
        target.closest('.channel-switcher__sidebar') || 
        target.closest('.channel-switcher__grid') || 
        target.closest('.episode-switcher-overlay')
      ) return;
      
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      adjustVolume(delta);
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, [isLocked, showAudioSubMenu, showSpeedMenu, containerRef, adjustVolume]);

  // Souris : clic = play/pause, double-clic = plein écran (timer 250ms pour les distinguer)
  // Tactile : tap = afficher/masquer les contrôles, double-tap gauche/droite = ∓10s, centre = play/pause
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const lastPointerTypeRef = useRef<string>('mouse');

  // Latest handlers, read at event/timer time. `skip` is recreated on every time-pos tick:
  // re-subscribing the listeners on each change cancelled the pending 250ms tap/click timer
  // in the effect cleanup (taps and single clicks randomly ignored during playback).
  const gestureRef = useRef({ isLocked, togglePlayPause, toggleFullscreen, onOverlayPlayPause, onTouchTap, skip });
  // eslint-disable-next-line react-hooks/refs -- derniers gestionnaires, lus au moment du geste ; réabonner les écouteurs annulait la tape en attente
  gestureRef.current = { isLocked, togglePlayPause, toggleFullscreen, onOverlayPlayPause, onTouchTap, skip };

  useEffect(() => {
    const isInteractive = (target: HTMLElement) =>
      !!target.closest('button, input, [role="menu"], .player-top-bar, .player-bottom-bar, .player-smart-lock-fixed, .channel-switcher, .episode-switcher-overlay, .episode-switcher-backdrop');

    const handleTouchTap = (e: MouseEvent, container: HTMLElement) => {
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.time < 300 && Math.abs(e.clientX - last.x) < 60) {
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        lastTapRef.current = null;
        const g = gestureRef.current;
        if (g.isLocked) return;
        const rect = container.getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        if (relX < 1 / 3) void g.skip(-10);
        else if (relX > 2 / 3) void g.skip(10);
        else {
          void g.togglePlayPause();
          g.onOverlayPlayPause?.();
        }
        return;
      }
      lastTapRef.current = { time: now, x: e.clientX };
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        lastTapRef.current = null;
        gestureRef.current.onTouchTap?.();
      }, 250);
    };

    const handlePointerDown = (e: PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType;
    };

    const handleClick = (e: MouseEvent) => {
      if (isInteractive(e.target as HTMLElement)) return;
      if (lastPointerTypeRef.current === 'touch' && containerRef.current) {
        handleTouchTap(e, containerRef.current);
        return;
      }
      if (gestureRef.current.isLocked) return;

      // Delay play/pause to allow double-click detection
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        void gestureRef.current.togglePlayPause();
        gestureRef.current.onOverlayPlayPause?.();
      }, 250);
    };

    const handleDblClick = (e: MouseEvent) => {
      // Double-tap tactile : déjà géré par handleTouchTap (seek / play-pause)
      if (lastPointerTypeRef.current === 'touch') return;
      if (gestureRef.current.isLocked) return;
      if (isInteractive(e.target as HTMLElement)) return;

      // Cancel pending play/pause from single click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      e.preventDefault();
      void gestureRef.current.toggleFullscreen();
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('pointerdown', handlePointerDown);
      container.addEventListener('click', handleClick);
      container.addEventListener('dblclick', handleDblClick);
      return () => {
        container.removeEventListener('pointerdown', handlePointerDown);
        container.removeEventListener('click', handleClick);
        container.removeEventListener('dblclick', handleDblClick);
        if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      };
    }
  }, [containerRef]);
}
