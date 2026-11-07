/**
 * Tests pour usePlaybackRetry.ts — compte à rebours de la reconnexion espacée.
 *
 * Le compteur de tentatives est fourni par PlayerContext : les tests simulent un contexte
 * minimal qui l'incrémente à chaque relance, et démontent/remontent le hook comme le fait
 * l'écran d'erreur (démonté pendant chaque relance).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlaybackRetry } from '../usePlaybackRetry';
import type { PlaybackError } from '../../services/player/playbackErrors';

let os: 'android' | 'ios' | 'windows' = 'windows';
vi.mock('../../utils/platform', () => ({ isAndroid: () => os === 'android', usesNyxPlugin: () => os !== 'windows' }));

/** Simule l'app qui passe en arrière-plan (touche Accueil, appel) ou qui revient */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

const limit: PlaybackError = { kind: 'connection_limit', httpStatus: 458 };

describe('usePlaybackRetry', () => {
  beforeEach(() => { vi.useFakeTimers(); os = 'windows'; setHidden(false); });
  afterEach(() => { vi.useRealTimers(); setHidden(false); });

  it('espace les relances 30 → 60 → 120 → 180 s même si l\'écran est remonté à chaque échec, puis s\'arrête', () => {
    let attempt = 0;
    const retryTimes: number[] = [];
    const start = Date.now();
    const retry = vi.fn(() => { attempt += 1; retryTimes.push((Date.now() - start) / 1000); });

    // Chaque échec = nouvel écran d'erreur (nouveau montage du hook)
    for (let i = 0; i < 6; i++) {
      const { unmount } = renderHook(() => usePlaybackRetry({ ...limit }, attempt, retry));
      act(() => { vi.advanceTimersByTime(300_000); });
      unmount();
    }

    expect(retry).toHaveBeenCalledTimes(4);
    const gaps = retryTimes.map((t, i) => t - (i === 0 ? 0 : retryTimes[i - 1]));
    expect(gaps).toEqual([30, 60 + 270, 120 + 240, 180 + 180]);
  });

  it('donne le bon délai selon la tentative en cours', () => {
    const retry = vi.fn();
    const { result, rerender } = renderHook(({ attempt }) => usePlaybackRetry(limit, attempt, retry), {
      initialProps: { attempt: 0 },
    });
    expect(result.current.secondsLeft).toBe(30);
    rerender({ attempt: 2 });
    expect(result.current.secondsLeft).toBe(120);
    rerender({ attempt: 4 });
    expect(result.current.secondsLeft).toBeNull();
    expect(result.current.exhausted).toBe(true);
  });

  it('ne relance jamais automatiquement un accès refusé ou un format non supporté', () => {
    const retry = vi.fn();
    renderHook(() => usePlaybackRetry({ kind: 'access_denied', httpStatus: 403 }, 0, retry));
    renderHook(() => usePlaybackRetry({ kind: 'unsupported_format' }, 0, retry));
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(retry).not.toHaveBeenCalled();
  });

  it('annuler stoppe la reconnexion automatique', () => {
    const retry = vi.fn();
    const { result } = renderHook(() => usePlaybackRetry(limit, 0, retry));
    act(() => { result.current.cancel(); });
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.cancelled).toBe(true);
  });

  it('« Réessayer maintenant » relance immédiatement (anti-spam appliqué par PlayerContext)', () => {
    const retry = vi.fn();
    const { result } = renderHook(() => usePlaybackRetry(limit, 1, retry));
    act(() => { result.current.retryNow(); });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.secondsLeft).toBeNull();
  });

  it('Android : le compte à rebours s\'arrête en arrière-plan et reprend au retour', () => {
    os = 'android';
    const retry = vi.fn();
    const { result } = renderHook(() => usePlaybackRetry(limit, 0, retry));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current.secondsLeft).toBe(20);

    // Touche Accueil : aucune relance, même après bien plus que le délai
    setHidden(true);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.secondsLeft).toBe(20);

    // Retour dans l'app : le compte reprend là où il s'était arrêté
    setHidden(false);
    act(() => { vi.advanceTimersByTime(19_000); });
    expect(retry).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('iOS : décompte en pause quand la page est cachée', () => {
    os = 'ios';
    const retry = vi.fn();
    const { result } = renderHook(() => usePlaybackRetry(limit, 0, retry));
    act(() => { vi.advanceTimersByTime(10_000); });
    setHidden(true);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(retry).not.toHaveBeenCalled();
    expect(result.current.secondsLeft).toBe(20);

    setHidden(false);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('Windows : une fenêtre réduite continue de se reconnecter (comportement inchangé)', () => {
    const retry = vi.fn();
    renderHook(() => usePlaybackRetry(limit, 0, retry));
    setHidden(true);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
