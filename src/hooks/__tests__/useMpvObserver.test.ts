/**
 * useMpvObserver : lecteur Windows et direct.
 *
 * - Sous Windows, mpv envoie la position à chaque image (25 à 60 fois par seconde) et tout le
 *   lecteur était redessiné autant de fois. L'affichage suit désormais la position ≈ 4 fois par seconde.
 * - Un lecteur fermé avant la fin de son abonnement aux événements gardait son écouteur.
 * - Statistiques relevées toutes les 2 s sans attendre le relevé précédent.
 * - Les changements de la liste des pistes sont signalés (seul signal sur un direct).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type PropertyEvent = { name: string; data?: unknown };

const { observeProperties, getProperty, observer } = vi.hoisted(() => ({
  observeProperties: vi.fn(),
  getProperty: vi.fn(),
  observer: {
    callback: null as ((event: PropertyEvent) => void) | null,
    resolve: null as ((unlisten: () => void) => void) | null,
  },
}));

vi.mock('../../services/player/mpvApi', () => ({ observeProperties, getProperty }));
vi.mock('../../services/preferencesService', () => ({
  isBingeModeEnabled: () => false,
  getBingeCountdown: () => 10,
}));

import { useMpvObserver, TIME_POS_UI_INTERVAL_MS, GEEK_STATS_INTERVAL_MS } from '../useMpvObserver';

const emit = (name: string, data: unknown) => act(() => { observer.callback?.({ name, data }); });

describe('useMpvObserver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observer.callback = null;
    observer.resolve = null;
    observeProperties.mockReset().mockImplementation((_props: string[], callback: (e: PropertyEvent) => void) => {
      observer.callback = callback;
      return new Promise<() => void>((resolve) => { observer.resolve = resolve; });
    });
    getProperty.mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it('lecteur fermé avant la fin de l\'abonnement : l\'écouteur est retiré dès son arrivée', async () => {
    const unlisten = vi.fn();
    const { unmount } = renderHook(() => useMpvObserver(true, undefined, undefined, false));
    unmount();

    await act(async () => { observer.resolve?.(unlisten); });

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('abonnement arrivé puis lecteur fermé : l\'écouteur est retiré une fois', async () => {
    const unlisten = vi.fn();
    const { unmount } = renderHook(() => useMpvObserver(true, undefined, undefined, false));
    await act(async () => { observer.resolve?.(unlisten); });
    unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('60 positions par seconde : l\'affichage n\'est mis à jour qu\'environ 5 fois', async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useMpvObserver(true, undefined, undefined, false);
    });
    await act(async () => { observer.resolve?.(() => {}); });
    emit('time-pos', 100);
    const before = renders;

    for (let frame = 1; frame <= 60; frame++) {
      vi.advanceTimersByTime(1000 / 60);
      emit('time-pos', 100 + frame / 60);
    }

    const updates = renders - before;
    expect(updates).toBeGreaterThanOrEqual(4);
    expect(updates).toBeLessThanOrEqual(6);
    // Valeur exacte toujours disponible pour les sauts et raccourcis
    expect(result.current.currentTimeRef.current).toBeCloseTo(101);
    // L'affichage suit à moins d'un intervalle près
    expect(101 - result.current.currentTime).toBeLessThan(TIME_POS_UI_INTERVAL_MS / 1000 + 0.05);
  });

  it('un saut (seek, nouveau flux) et la mise en pause s\'affichent sans attendre', async () => {
    const { result } = renderHook(() => useMpvObserver(true, undefined, undefined, false));
    await act(async () => { observer.resolve?.(() => {}); });
    emit('time-pos', 100);

    vi.advanceTimersByTime(10);
    emit('time-pos', 400); // saut
    expect(result.current.currentTime).toBe(400);

    vi.advanceTimersByTime(10);
    emit('time-pos', 400.01); // retenu par la limite
    expect(result.current.currentTime).toBe(400);
    emit('pause', true); // pause : position exacte affichée
    expect(result.current.currentTime).toBe(400.01);
  });

  it('Android (une position toutes les 250 ms) : aucune position n\'est retenue', async () => {
    const { result } = renderHook(() => useMpvObserver(true, undefined, undefined, false));
    await act(async () => { observer.resolve?.(() => {}); });
    emit('time-pos', 10);
    for (let i = 1; i <= 8; i++) {
      vi.advanceTimersByTime(250);
      emit('time-pos', 10 + i * 0.25);
      expect(result.current.currentTime).toBe(10 + i * 0.25);
    }
  });

  it('chaque changement de la liste des pistes est signalé, avec ou sans la liste (Android)', async () => {
    const { result } = renderHook(() => useMpvObserver(true, undefined, undefined, false));
    await act(async () => { observer.resolve?.(() => {}); });
    expect(result.current.trackListRevision).toBe(0);

    emit('track-list', [{ id: 1, type: 'audio' }]);
    emit('track-list', null);

    expect(result.current.trackListRevision).toBe(2);
    expect(observeProperties.mock.calls[0][0]).toContain('track-list');
  });

  it('statistiques : un relevé lent n\'est jamais doublé par le suivant', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    getProperty.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5000)); // mpv lent : 5 s par relevé
      inFlight--;
      return null;
    });

    const { unmount } = renderHook(() => useMpvObserver(true, undefined, undefined, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(GEEK_STATS_INTERVAL_MS * 10); });
    unmount();

    // 11 propriétés lues en parallèle dans un relevé, jamais deux relevés en même temps
    expect(maxInFlight).toBe(11);
  });

  it('statistiques : plus de relevé une fois le panneau fermé', async () => {
    const { unmount } = renderHook(() => useMpvObserver(true, undefined, undefined, true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    getProperty.mockClear();

    await act(async () => { await vi.advanceTimersByTimeAsync(GEEK_STATS_INTERVAL_MS * 5); });
    expect(getProperty).not.toHaveBeenCalled();
  });
});
