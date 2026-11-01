import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStallWatchdog, useLiveEndWatchdog, STALL_TIMEOUT_MS, LIVE_END_CONFIRM_MS, LIVE_RECONNECT_GRACE_MS } from '../useStallWatchdog';
import { subscribePlaybackErrors } from '../../services/player/playbackErrors';

describe('useStallWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('signale une erreur réseau après une mise en tampon trop longue', () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));

    renderHook(() => useStallWatchdog(true, false, true));
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 1000);
    expect(errors).toHaveLength(0);

    vi.advanceTimersByTime(2000);
    expect(errors).toEqual([{ kind: 'network', engine: 'mpv' }]);
    unsubscribe();
  });

  it('ne signale rien en pause, hors lecture, ou si le tampon se remplit', () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));

    const paused = renderHook(() => useStallWatchdog(true, true, true));
    vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
    paused.unmount();

    const disconnected = renderHook(() => useStallWatchdog(true, false, false));
    vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);
    disconnected.unmount();

    const recovered = renderHook(({ buffering }) => useStallWatchdog(buffering, false, true), {
      initialProps: { buffering: true },
    });
    vi.advanceTimersByTime(STALL_TIMEOUT_MS - 2000);
    recovered.rerender({ buffering: false });
    vi.advanceTimersByTime(STALL_TIMEOUT_MS * 2);

    expect(errors).toHaveLength(0);
    unsubscribe();
  });
});

describe('useLiveEndWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('un direct coupé par le fournisseur (fin atteinte) déclenche une erreur réseau, une fois', () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));

    const { rerender } = renderHook(({ eof }) => useLiveEndWatchdog(eof, true, true), {
      initialProps: { eof: false },
    });
    vi.advanceTimersByTime(60_000);
    expect(errors).toHaveLength(0);

    rerender({ eof: true });
    vi.advanceTimersByTime(LIVE_END_CONFIRM_MS - 500);
    expect(errors).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(errors).toEqual([{ kind: 'network', engine: 'mpv' }]);

    // Toujours figé en fin : pas de nouvelle erreur tant que rien ne change
    vi.advanceTimersByTime(60_000);
    expect(errors).toHaveLength(1);

    // Relance, le flux repart puis retombe : nouvelle erreur
    rerender({ eof: false });
    rerender({ eof: true });
    vi.advanceTimersByTime(LIVE_END_CONFIRM_MS + 500);
    expect(errors).toHaveLength(2);
    unsubscribe();
  });

  it('ignore la fin d\'un film ou d\'un épisode, une fin fugace, et le lecteur déconnecté', () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));

    const vod = renderHook(() => useLiveEndWatchdog(true, false, true));
    vi.advanceTimersByTime(60_000);
    vod.unmount();

    const disconnected = renderHook(() => useLiveEndWatchdog(true, true, false));
    vi.advanceTimersByTime(60_000);
    disconnected.unmount();

    const flicker = renderHook(({ eof }) => useLiveEndWatchdog(eof, true, true), {
      initialProps: { eof: true },
    });
    vi.advanceTimersByTime(LIVE_END_CONFIRM_MS - 1000);
    flicker.rerender({ eof: false });
    vi.advanceTimersByTime(60_000);

    expect(errors).toHaveLength(0);
    unsubscribe();
  });
});

/**
 * Un direct coupé affichait l'écran d'erreur au bout de 3 s, et la première reconnexion
 * automatique n'arrivait que 30 s plus tard. La première coupure est maintenant relancée tout de suite,
 * sans écran d'erreur ; la suivante (avant que le direct soit reparti pour de bon) garde l'écran
 * d'erreur et sa reconnexion espacée.
 */
describe('useLiveEndWatchdog — reconnexion immédiate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('première coupure : relance tout de suite, sans écran d\'erreur', async () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));
    const reconnect = vi.fn();

    const { rerender } = renderHook(
      ({ eof }) => useLiveEndWatchdog(eof, true, true, 0, reconnect),
      { initialProps: { eof: false } },
    );
    rerender({ eof: true });
    await vi.advanceTimersByTimeAsync(LIVE_END_CONFIRM_MS + 100);
    expect(reconnect).toHaveBeenCalledTimes(1);

    // Le nouveau flux se charge (fin plus atteinte) puis repart : aucune erreur
    rerender({ eof: false });
    await vi.advanceTimersByTimeAsync(LIVE_RECONNECT_GRACE_MS * 2);
    expect(errors).toHaveLength(0);
    unsubscribe();
  });

  it('coupure pendant une série de relances : écran d\'erreur, pas de relance immédiate', async () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));
    const reconnect = vi.fn();

    renderHook(() => useLiveEndWatchdog(true, true, true, 1, reconnect));
    await vi.advanceTimersByTimeAsync(LIVE_END_CONFIRM_MS + 100);

    expect(reconnect).not.toHaveBeenCalled();
    expect(errors).toEqual([{ kind: 'network', engine: 'mpv' }]);
    unsubscribe();
  });

  it('relance qui ne part pas (fin toujours atteinte) : écran d\'erreur après le délai de grâce', async () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));
    const reconnect = vi.fn();

    renderHook(() => useLiveEndWatchdog(true, true, true, 0, reconnect));
    await vi.advanceTimersByTimeAsync(LIVE_END_CONFIRM_MS + 100);
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(LIVE_RECONNECT_GRACE_MS);
    expect(errors).toEqual([{ kind: 'network', engine: 'mpv' }]);
    expect(reconnect).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('relance qui échoue (rejet) : pas d\'erreur non gérée, l\'écran d\'erreur vient après le délai', async () => {
    const errors: unknown[] = [];
    const unsubscribe = subscribePlaybackErrors((e) => errors.push(e));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reconnect = vi.fn().mockRejectedValue(new Error('offline'));

    renderHook(() => useLiveEndWatchdog(true, true, true, 0, reconnect));
    await vi.advanceTimersByTimeAsync(LIVE_END_CONFIRM_MS + LIVE_RECONNECT_GRACE_MS + 100);

    expect(errors).toEqual([{ kind: 'network', engine: 'mpv' }]);
    warn.mockRestore();
    unsubscribe();
  });

  it('films et épisodes : jamais de relance à leur fin', async () => {
    const reconnect = vi.fn();
    renderHook(() => useLiveEndWatchdog(true, false, true, 0, reconnect));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reconnect).not.toHaveBeenCalled();
  });
});
