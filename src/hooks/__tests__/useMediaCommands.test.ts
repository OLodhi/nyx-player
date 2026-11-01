/**
 * Tests pour useMediaCommands.ts — chaîne suivante / précédente venue d'Android.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

type Listener = (command: 'next' | 'previous') => void;
const listeners: Listener[] = [];
const unlisten = vi.fn();

vi.mock('../../services/player/mpvApi', () => ({
  listenMediaCommands: vi.fn(async (callback: Listener) => {
    listeners.push(callback);
    return () => {
      unlisten();
      listeners.splice(listeners.indexOf(callback), 1);
    };
  }),
}));

import { useMediaCommands } from '../useMediaCommands';

describe('useMediaCommands', () => {
  beforeEach(() => {
    listeners.length = 0;
    unlisten.mockClear();
  });

  it('direct : suivante et précédente changent de chaîne et affichent les contrôles', async () => {
    const zap = vi.fn();
    const showControls = vi.fn();
    renderHook(() => useMediaCommands(zap, showControls));
    await waitFor(() => expect(listeners).toHaveLength(1));
    listeners[0]('next');
    listeners[0]('previous');
    expect(zap.mock.calls).toEqual([[1], [-1]]);
    expect(showControls).toHaveBeenCalledTimes(2);
  });

  it("hors du direct : n'écoute rien", async () => {
    renderHook(() => useMediaCommands(undefined));
    await Promise.resolve();
    expect(listeners).toHaveLength(0);
  });

  it('suit la dernière fonction de zap sans se réabonner', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ zap }) => useMediaCommands(zap), { initialProps: { zap: first } });
    await waitFor(() => expect(listeners).toHaveLength(1));
    rerender({ zap: second });
    listeners[0]('next');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1);
    expect(listeners).toHaveLength(1);
  });

  it("se désabonne en quittant le direct ou le lecteur", async () => {
    const { rerender, unmount } = renderHook(({ zap }) => useMediaCommands(zap), {
      initialProps: { zap: vi.fn() as ((delta: number) => void) | undefined },
    });
    await waitFor(() => expect(listeners).toHaveLength(1));
    rerender({ zap: undefined });
    expect(unlisten).toHaveBeenCalledTimes(1);
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("désabonne une écoute arrivée après le démontage", async () => {
    const { unmount } = renderHook(() => useMediaCommands(vi.fn()));
    unmount();
    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});
