/**
 * Tests pour usePlayerKeyboard.ts — gestes souris / tactile sur la vidéo
 *
 * Régression : `skip` est recréé à chaque tick time-pos ; le re-render ne doit pas
 * annuler le timer 250ms d'un clic (play/pause) ou d'un tap (afficher les contrôles).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlayerKeyboard } from '../usePlayerKeyboard';

vi.mock('../../services/player/mpvApi', () => ({
  setProperty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/preferencesService', () => ({
  isGeekStatsEnabled: () => false,
}));

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const containerRef = { current: container };
  const handlers = {
    togglePlayPause: vi.fn(),
    toggleMute: vi.fn(),
    toggleFullscreen: vi.fn(),
    setShowGeekStats: vi.fn(),
    onOverlayPlayPause: vi.fn(),
    onTouchTap: vi.fn(),
  };
  const options = {
    isLocked: false,
    showAudioSubMenu: false,
    showSpeedMenu: false,
    containerRef,
    volumeRef: { current: 50 },
    setVolumeState: vi.fn(),
    setIsMuted: vi.fn(),
  };
  const hook = renderHook(
    ({ skip }) => usePlayerKeyboard({ ...handlers, skip }, options),
    { initialProps: { skip: vi.fn() } },
  );
  return { container, handlers, hook };
}

function pointer(container: HTMLElement, pointerType: string) {
  const down = new MouseEvent('pointerdown', { bubbles: true });
  Object.defineProperty(down, 'pointerType', { value: pointerType });
  container.dispatchEvent(down);
  container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200 }));
}

describe('usePlayerKeyboard — gestes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('clic souris : play/pause même si skip change pendant le délai double-clic', () => {
    const { container, handlers, hook } = setup();

    act(() => { pointer(container, 'mouse'); });
    hook.rerender({ skip: vi.fn() }); // tick time-pos
    act(() => { vi.advanceTimersByTime(300); });

    expect(handlers.togglePlayPause).toHaveBeenCalledTimes(1);
  });

  it('tap tactile : affiche/masque les contrôles même si skip change pendant le délai', () => {
    const { container, handlers, hook } = setup();

    act(() => { pointer(container, 'touch'); });
    hook.rerender({ skip: vi.fn() });
    act(() => { vi.advanceTimersByTime(300); });

    expect(handlers.onTouchTap).toHaveBeenCalledTimes(1);
    expect(handlers.togglePlayPause).not.toHaveBeenCalled();
  });

  it('double-tap tactile à droite : utilise le skip le plus récent', () => {
    const { container, hook } = setup();
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ left: 0, width: 240, top: 0, height: 100 }),
    });
    const latestSkip = vi.fn();

    act(() => { pointer(container, 'touch'); });
    hook.rerender({ skip: latestSkip });
    act(() => { pointer(container, 'touch'); });

    expect(latestSkip).toHaveBeenCalledWith(10);
  });
});

describe('usePlayerKeyboard — volume', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('flèche haut : rétablit le son même si l\'affichage le croyait actif', async () => {
    const { setProperty } = await import('../../services/player/mpvApi');
    vi.mocked(setProperty).mockClear();
    setup();

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); });

    expect(setProperty).toHaveBeenCalledWith('volume', 55);
    expect(setProperty).toHaveBeenCalledWith('mute', false);
  });
});
