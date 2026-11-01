/**
 * Tests pour usePeriodicSave.ts
 *
 * Vérifie que la sauvegarde périodique se déclenche correctement
 * et respecte les conditions (contentId, isConnected, duration, currentTime > 10).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePeriodicSave } from '../usePeriodicSave';

// Mock playbackProgressService
vi.mock('../../services/playbackProgressService', () => ({
  updateProgress: vi.fn().mockResolvedValue(undefined),
}));

import { updateProgress } from '../../services/playbackProgressService';

describe('usePeriodicSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne sauvegarde pas si contentId est undefined', () => {
    renderHook(() => usePeriodicSave(undefined, true, 3600, 120));

    act(() => { vi.advanceTimersByTime(35000); });

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('ne sauvegarde pas si isConnected est false', () => {
    renderHook(() => usePeriodicSave('123', false, 3600, 120));

    act(() => { vi.advanceTimersByTime(35000); });

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('ne sauvegarde pas si duration est 0', () => {
    renderHook(() => usePeriodicSave('123', true, 0, 120));

    act(() => { vi.advanceTimersByTime(35000); });

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('ne sauvegarde pas si currentTime <= 10', () => {
    renderHook(() => usePeriodicSave('123', true, 3600, 5));

    act(() => { vi.advanceTimersByTime(35000); });

    expect(updateProgress).not.toHaveBeenCalled();
  });

  it('sauvegarde après 30s quand toutes les conditions sont remplies', () => {
    renderHook(() => usePeriodicSave('123', true, 3600, 120));

    // Pas de sauvegarde avant 30s
    act(() => { vi.advanceTimersByTime(29000); });
    expect(updateProgress).not.toHaveBeenCalled();

    // Sauvegarde à 30s
    act(() => { vi.advanceTimersByTime(1000); });
    expect(updateProgress).toHaveBeenCalledWith(123, 120, 3600);
  });

  it('sauvegarde périodiquement (2 appels en 60s+)', () => {
    renderHook(() => usePeriodicSave('456', true, 7200, 300));

    act(() => { vi.advanceTimersByTime(30000); });
    expect(updateProgress).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(30000); });
    expect(updateProgress).toHaveBeenCalledTimes(2);
  });

  it('nettoie l\'intervalle au unmount', () => {
    const { unmount } = renderHook(() => usePeriodicSave('123', true, 3600, 120));

    unmount();

    act(() => { vi.advanceTimersByTime(60000); });
    expect(updateProgress).not.toHaveBeenCalled();
  });
});

describe('usePeriodicSave — durée affinée par mpv', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('la sauvegarde part toutes les 30 s même si la durée change toutes les 10 s', () => {
    const { rerender } = renderHook(({ duration }) => usePeriodicSave('123', true, duration, 600), {
      initialProps: { duration: 3600 },
    });

    for (let i = 1; i <= 9; i++) {
      act(() => { vi.advanceTimersByTime(10000); });
      rerender({ duration: 3600 + i });
    }
    // 90 s écoulées : 3 sauvegardes, avec la dernière durée connue
    expect(updateProgress).toHaveBeenCalledTimes(3);
    expect(updateProgress).toHaveBeenLastCalledWith(123, 600, 3608);
  });
});
