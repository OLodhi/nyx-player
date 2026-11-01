/**
 * Position enregistrée réappliquée et second saut évité quand le flux s'ouvre déjà à la
 * bonne position.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { command, getProperty, getProgressByStreamId } = vi.hoisted(() => ({
  command: vi.fn().mockResolvedValue(undefined),
  getProperty: vi.fn(),
  getProgressByStreamId: vi.fn(),
}));

vi.mock('../../services/player/mpvApi', () => ({
  setProperty: vi.fn().mockResolvedValue(undefined),
  getProperty,
  command,
}));
vi.mock('../../services/preferencesService', () => ({
  getSubtitleScale: () => 1,
  setSubtitleScale: vi.fn(),
}));
vi.mock('../../services/playbackProgressService', () => ({
  finalizePlayback: vi.fn().mockResolvedValue(undefined),
  getProgressByStreamId,
}));
vi.mock('../../services/contentPreferencesService', () => ({
  getPlaybackSpeed: vi.fn().mockResolvedValue(null),
  setPlaybackSpeed: vi.fn(),
  getSavedTracks: vi.fn().mockResolvedValue(null),
  saveAudioPreference: vi.fn(),
  saveSubPreference: vi.fn(),
}));

import { usePlayerPreferences } from '../usePlayerPreferences';

const seeks = () => command.mock.calls.filter(([name]) => name === 'seek').map(([, args]) => args);

describe('usePlayerPreferences — reprise de la position', () => {
  let timePos: number | null;
  beforeEach(() => {
    vi.useFakeTimers();
    command.mockClear();
    timePos = 0;
    getProperty.mockImplementation(async (name: string) => (name === 'time-pos' ? timePos : null));
    getProgressByStreamId.mockResolvedValue({ timeSeconds: 1200, durationSeconds: 5400, progressPercent: 22 });
  });
  afterEach(() => vi.useRealTimers());

  const mount = () => renderHook(
    ({ duration }) => usePlayerPreferences(true, '7', undefined, duration, 0, undefined, async () => {}, () => {}),
    { initialProps: { duration: 5400 } },
  );

  it('la durée affinée par mpv ne ramène plus à la position enregistrée', async () => {
    const { rerender } = mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(seeks()).toEqual([['1200', 'absolute']]);

    // L'utilisateur avance, mpv affine la durée plusieurs fois
    timePos = 3000;
    for (const duration of [5401.2, 5402.8, 5399.9]) {
      rerender({ duration });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    }
    expect(seeks()).toHaveLength(1);
  });

  it('flux déjà ouvert à la position enregistrée : pas de second saut', async () => {
    timePos = 1201.3;
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(seeks()).toEqual([]);
  });
});
