/**
 * `skip` dépendait de la position affichée. Recréé à chaque tic de lecture, il faisait
 * détacher puis rattacher l'écouteur clavier du lecteur (usePlayerKeyboard) 25 à 60 fois par seconde
 * sous Windows. Il lit maintenant la position exacte dans une ref.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { command } = vi.hoisted(() => ({ command: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../../services/player/mpvApi', () => ({ setProperty: vi.fn().mockResolvedValue(undefined), command }));
vi.mock('../../services/mpvBridge', () => ({ mpvStop: vi.fn() }));
vi.mock('../../services/player/androidPlayer', () => ({ setFullscreen: vi.fn(), observeProperties: vi.fn() }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => false, usesNyxPlugin: () => false }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: () => Promise.resolve(() => {}),
    isFullscreen: () => Promise.resolve(false),
  }),
}));

import { usePlayerActions } from '../usePlayerActions';

type Mpv = Parameters<typeof usePlayerActions>[0]['mpv'];

const makeMpv = (currentTime: number, exact: number) => ({
  currentTime,
  duration: 3600,
  isPaused: false,
  currentTimeRef: { current: exact },
  durationRef: { current: 3600 },
  timePosUpdatesRef: { current: 0 },
  setCurrentTime: vi.fn(),
  setIsSeeking: vi.fn(),
}) as unknown as Mpv;

describe('usePlayerActions.skip', () => {
  it('garde la même fonction pendant la lecture (l\'écouteur clavier n\'est plus rattaché à chaque tic)', () => {
    const shared = makeMpv(10, 10);
    const { result, rerender } = renderHook(
      ({ mpv }) => usePlayerActions({ mpv, prefs: { savePlaybackPosition: () => undefined }, onClose: () => {}, progressRef: { current: null } }),
      { initialProps: { mpv: shared } },
    );
    const first = result.current.skip;

    rerender({ mpv: { ...shared, currentTime: 10.25 } as Mpv });
    rerender({ mpv: { ...shared, currentTime: 10.5 } as Mpv });

    expect(result.current.skip).toBe(first);
  });

  it('part de la position exacte, pas de la dernière position affichée', async () => {
    const mpv = makeMpv(100, 100.2);
    const { result } = renderHook(() => usePlayerActions({
      mpv, prefs: { savePlaybackPosition: () => undefined }, onClose: () => {}, progressRef: { current: null },
    }));

    await act(async () => { await result.current.skip(10); });

    expect(mpv.setCurrentTime).toHaveBeenCalledWith(110.2);
    expect(command).toHaveBeenCalledWith('seek', ['10', 'relative']);
  });
});
