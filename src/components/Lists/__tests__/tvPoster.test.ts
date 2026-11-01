import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Prepared = { ready: string[]; failed: string[]; dropped?: string[] };
const env = vi.hoisted(() => ({
  tauri: true,
  platform: 'android',
  // Réponse de poster_prepare : par défaut rien n'est encore prêt
  answer: (() => ({ ready: [], failed: [] })) as (urls: string[], urgent: boolean) => Prepared,
  listeners: new Map<string, (event: { payload: { u: string } }) => void>(),
}));
const invoke = vi.hoisted(() =>
  vi.fn(async (command: string, args?: { urls: string[]; urgent: boolean }) =>
    command === 'poster_prepare' ? env.answer(args!.urls, args!.urgent) : undefined,
  ),
);
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => env.tauri, invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, handler: (event: { payload: { u: string } }) => void) => {
    env.listeners.set(name, handler);
    return () => env.listeners.delete(name);
  },
}));
vi.mock('../../../utils/platform', () => ({ getPlatform: () => env.platform }));

import {
  clearShrunkPosters,
  fallbackPosterSrc,
  onPosterSettled,
  prefetchShrunkPosters,
  setShrinkProviderPosters,
  tvPosterSrc,
} from '../tvPoster';

/** Évènement de l'appli native : l'affiche est prête (true) ou ne le sera pas (false) */
const nativeSays = (url: string, ok: boolean) =>
  env.listeners.get(ok ? 'poster-ready' : 'poster-failed')!({ payload: { u: url } });

/** Demandes urgentes regroupées puis envoyées : attendre qu'elles aient reçu leur réponse */
const settleAsks = () => new Promise((resolve) => setTimeout(resolve, 0));

let serial = 0;
/** Chaque test a ses propres adresses : l'état du module (prêtes, en échec) dure tout le lancement */
const provider = (name = 'poster') => `http://192.0.2.10/images/${name}-${++serial}.jpg?token=a&b=1`;

beforeEach(() => {
  invoke.mockClear();
  env.answer = () => ({ ready: [], failed: [] });
});

afterEach(() => {
  setShrinkProviderPosters(true);
  env.tauri = true;
  env.platform = 'android';
  vi.useRealTimers();
});

describe('tvPosterSrc', () => {
  it('asks TMDB for the card width', () => {
    expect(tvPosterSrc('https://image.tmdb.org/t/p/w500/a.jpg')).toBe('https://image.tmdb.org/t/p/w185/a.jpg');
  });

  it('leaves provider posters untouched while shrinking is off', () => {
    setShrinkProviderPosters(false);
    const url = provider();
    expect(tvPosterSrc(url)).toBe(url);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('keeps TMDB, local images and the browser preview off the shrinker', () => {
    expect(tvPosterSrc('https://image.tmdb.org/t/p/w342/a.jpg')).toBe('https://image.tmdb.org/t/p/w185/a.jpg');
    expect(tvPosterSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    env.tauri = false;
    const url = provider();
    expect(tvPosterSrc(url)).toBe(url);
  });

  it('keeps the card empty until the native app says the poster is ready, then serves it from disk', async () => {
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    const settled = vi.fn();
    onPosterSettled(url, settled);
    await settleAsks();
    // Une seule demande urgente, même si la carte se redessine entre-temps
    expect(tvPosterSrc(url)).toBeNull();
    await settleAsks();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('poster_prepare', { urls: [url], width: 185, urgent: true });

    nativeSays(url, true);
    expect(settled).toHaveBeenCalledTimes(1);
    const src = tvPosterSrc(url)!;
    expect(src.startsWith('http://nyxposter.localhost/185?u=')).toBe(true);
    expect(fallbackPosterSrc(src)).toBe(url);
  });

  it('asks for all the cards of a row at once', async () => {
    const row = [provider('a'), provider('b'), provider('c')];
    row.forEach((url) => expect(tvPosterSrc(url)).toBeNull());
    await settleAsks();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1]).toEqual({ urls: row, width: 185, urgent: true });
  });

  it('uses a poster already on disk as soon as the native app answers', async () => {
    const url = provider();
    env.answer = (urls) => ({ ready: urls, failed: [] });
    expect(tvPosterSrc(url)).toBeNull();
    const settled = vi.fn();
    onPosterSettled(url, settled);
    await settleAsks();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(tvPosterSrc(url)!.startsWith('http://nyxposter.localhost/')).toBe(true);
  });

  it('falls back to the original when the native app cannot shrink it, without asking again', async () => {
    const url = provider('animated');
    expect(tvPosterSrc(url)).toBeNull();
    await settleAsks();
    nativeSays(url, false);
    expect(tvPosterSrc(url)).toBe(url);
    await settleAsks();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original when the native app is missing', async () => {
    const url = provider();
    invoke.mockRejectedValueOnce(new Error('commande inconnue'));
    expect(tvPosterSrc(url)).toBeNull();
    await settleAsks();
    expect(tvPosterSrc(url)).toBe(url);
  });

  it('never leaves a card empty for good when the poster is late', async () => {
    vi.useFakeTimers();
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    const settled = vi.fn();
    onPosterSettled(url, settled);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(tvPosterSrc(url)).toBe(url);

    // Prête plus tard tout de même : les remplissages suivants la prennent en petit
    nativeSays(url, true);
    expect(tvPosterSrc(url)!.startsWith('http://nyxposter.localhost/')).toBe(true);
  });

  it('a late poster dropped by the native queue is asked again when its card is filled again', async () => {
    vi.useFakeTimers();
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(12_000);
    // Jetée de la file sans jamais être signalée : la carte a pris l'original
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url))).toHaveLength(1);
    // Remplie de nouveau un peu plus tard (on est revenu sur la rangée) : redemandée
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    const asks = invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url));
    expect(asks).toHaveLength(2);
    // Une seule nouvelle demande tant que la précédente n'a pas de réponse
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url))).toHaveLength(2);
    nativeSays(url, true);
    expect(tvPosterSrc(url)!.startsWith('http://nyxposter.localhost/')).toBe(true);
  });

  it('a poster dropped by the native queue does not leave its card empty for 12 s', async () => {
    vi.useFakeTimers();
    const kept = provider();
    const dropped = provider();
    env.answer = (urls) => ({ ready: [], failed: [], dropped: urls.filter((u) => u === dropped) });
    expect(tvPosterSrc(kept)).toBeNull();
    expect(tvPosterSrc(dropped)).toBeNull();
    const settled = vi.fn();
    onPosterSettled(dropped, settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(tvPosterSrc(dropped)).toBe(dropped);
    expect(tvPosterSrc(kept)).toBeNull();
  });

  it('a dropped poster is not asked again by the fill its own fallback triggers', async () => {
    vi.useFakeTimers();
    const url = provider();
    env.answer = (urls, urgent) => ({ ready: [], failed: [], dropped: urgent ? urls : [] });
    expect(tvPosterSrc(url)).toBeNull();
    // La carte réveillée se remplit aussitôt avec l'original : pas de nouvelle demande qui repasserait en tête de file
    onPosterSettled(url, () => expect(tvPosterSrc(url)).toBe(url));
    await vi.advanceTimersByTimeAsync(0);
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url))).toHaveLength(1);
  });

  it('a re-ask dropped again waits before the next one', async () => {
    vi.useFakeTimers();
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(2_000);
    env.answer = (urls) => ({ ready: [], failed: [], dropped: urls });
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    // Jetée de nouveau : le rendu suivant de la carte (simple changement de sélection) ne la renvoie pas en tête de file
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url))).toHaveLength(2);
  });

  it('a late poster the native app then fails to shrink is not asked again', async () => {
    vi.useFakeTimers();
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tvPosterSrc(url)).toBe(url);
    await vi.advanceTimersByTimeAsync(0);
    nativeSays(url, false);
    for (let fill = 0; fill < 3; fill++) {
      await vi.advanceTimersByTimeAsync(2_000);
      expect(tvPosterSrc(url)).toBe(url);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(invoke.mock.calls.filter(([, args]) => (args as { urls: string[] }).urls.includes(url))).toHaveLength(2);
  });

  it('a wait started before the cache was cleared does not cut the next one short', async () => {
    vi.useFakeTimers();
    const url = provider();
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    await clearShrunkPosters();
    // Demandée de nouveau à 5 s : elle a droit à ses 12 s, l'ancien délai (à 12 s) ne la fait pas échouer
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(tvPosterSrc(url)).toBeNull();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(tvPosterSrc(url)).toBe(url);
  });

  it('a cancelled wait is not called back (recycled card)', async () => {
    const url = provider();
    tvPosterSrc(url);
    const settled = vi.fn();
    const cancel = onPosterSettled(url, settled);
    cancel();
    await settleAsks();
    nativeSays(url, true);
    expect(settled).not.toHaveBeenCalled();
  });

  it('uses the custom scheme form outside Windows and Android', async () => {
    env.platform = 'linux';
    const url = provider();
    env.answer = (urls) => ({ ready: urls, failed: [] });
    tvPosterSrc(url);
    await settleAsks();
    const src = tvPosterSrc(url)!;
    expect(src.startsWith('nyxposter://localhost/185?u=')).toBe(true);
    expect(fallbackPosterSrc(src)).toBe(url);
  });

  it('a shrunk poster that fails to load goes back to the original for good', async () => {
    const url = provider();
    env.answer = (urls) => ({ ready: urls, failed: [] });
    tvPosterSrc(url);
    await settleAsks();
    expect(fallbackPosterSrc(tvPosterSrc(url)!)).toBe(url);
    expect(tvPosterSrc(url)).toBe(url);
  });

  it('has no original for an ordinary address', () => {
    expect(fallbackPosterSrc(provider())).toBeNull();
  });
});

describe('prefetchShrunkPosters', () => {
  it('sends the next rows to the native app once per list, without TMDB or duplicates', async () => {
    const urls = [provider('a'), provider('b')];
    prefetchShrunkPosters(['https://image.tmdb.org/t/p/w342/x.jpg', ...urls, urls[0], '']);
    await settleAsks();
    expect(invoke).toHaveBeenCalledWith('poster_prepare', { urls, width: 185, urgent: false });
  });

  it('an empty list clears what was waiting (home closed)', async () => {
    prefetchShrunkPosters([]);
    await settleAsks();
    expect(invoke).toHaveBeenCalledWith('poster_prepare', { urls: [], width: 185, urgent: false });
  });

  it('does not ask again for posters already ready', async () => {
    const url = provider();
    env.answer = (urls) => ({ ready: urls, failed: [] });
    prefetchShrunkPosters([url]);
    await settleAsks();
    prefetchShrunkPosters([url]);
    await settleAsks();
    expect(invoke.mock.calls[1][1]).toEqual({ urls: [], width: 185, urgent: false });
    expect(tvPosterSrc(url)!.startsWith('http://nyxposter.localhost/')).toBe(true);
  });

  it('does nothing while shrinking is off', async () => {
    setShrinkProviderPosters(false);
    prefetchShrunkPosters([provider()]);
    await settleAsks();
    expect(invoke).not.toHaveBeenCalled();
  });
});
