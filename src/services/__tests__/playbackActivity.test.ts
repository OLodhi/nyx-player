import { describe, it, expect, vi } from 'vitest';
import { isPlaybackBusy, onPlaybackBusyChange, setPlaybackBusy } from '../playbackActivity';

describe('playbackActivity', () => {
  it('prévient les abonnés seulement quand l\'état change', () => {
    const listener = vi.fn();
    const unsubscribe = onPlaybackBusyChange(listener);
    setPlaybackBusy(true);
    setPlaybackBusy(true);
    expect(isPlaybackBusy()).toBe(true);
    setPlaybackBusy(false);
    expect(listener.mock.calls).toEqual([[true], [false]]);
    unsubscribe();
    setPlaybackBusy(true);
    expect(listener).toHaveBeenCalledTimes(2);
    setPlaybackBusy(false);
  });

  it('un abonné en erreur n\'empêche pas les autres', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failing = onPlaybackBusyChange(() => { throw new Error('boum'); });
    const listener = vi.fn();
    const ok = onPlaybackBusyChange(listener);
    setPlaybackBusy(true);
    expect(listener).toHaveBeenCalledWith(true);
    failing();
    ok();
    setPlaybackBusy(false);
    warn.mockRestore();
  });
});
