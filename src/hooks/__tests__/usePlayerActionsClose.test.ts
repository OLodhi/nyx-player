/**
 * Fermeture du lecteur : la position est enregistrée avant de rendre la main, et un seul
 * « stop » part (mpvBridge.mpvStop, qui ignore le second appel de PlayerContext.stop).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { mpvStop, command } = vi.hoisted(() => ({
  mpvStop: vi.fn().mockResolvedValue(undefined),
  command: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/player/mpvApi', () => ({ setProperty: vi.fn().mockResolvedValue(undefined), command }));
vi.mock('../../services/mpvBridge', () => ({ mpvStop }));
vi.mock('../../services/player/androidPlayer', () => ({ setFullscreen: vi.fn(), observeProperties: vi.fn() }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => false, usesNyxPlugin: () => false }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: () => Promise.resolve(() => {}),
    isFullscreen: () => Promise.resolve(false),
  }),
}));

import { usePlayerActions, SAVE_ON_CLOSE_TIMEOUT_MS } from '../usePlayerActions';

const mpvState = {} as Parameters<typeof usePlayerActions>[0]['mpv'];

describe('usePlayerActions.handleClose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mpvStop.mockClear();
    command.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('attend la sauvegarde de la position avant de fermer, et n\'envoie pas « stop » en direct', async () => {
    const order: string[] = [];
    let finishSave: () => void = () => {};
    const savePlaybackPosition = vi.fn(() => new Promise<void>((resolve) => {
      finishSave = () => { order.push('saved'); resolve(); };
    }));
    const onClose = vi.fn(() => { order.push('closed'); });
    const { result } = renderHook(() => usePlayerActions({
      mpv: mpvState, prefs: { savePlaybackPosition }, onClose, progressRef: { current: null },
    }));

    let closing: Promise<void> = Promise.resolve();
    act(() => { closing = result.current.handleClose(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { finishSave(); await closing; });
    expect(order).toEqual(['saved', 'closed']);
    expect(mpvStop).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalledWith('stop');
  });

  it('sauvegarde bloquée : le lecteur se ferme quand même après le délai maximal', async () => {
    const onClose = vi.fn();
    const { result } = renderHook(() => usePlayerActions({
      mpv: mpvState, prefs: { savePlaybackPosition: () => new Promise<void>(() => {}) }, onClose, progressRef: { current: null },
    }));

    act(() => { void result.current.handleClose(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500 + SAVE_ON_CLOSE_TIMEOUT_MS); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
