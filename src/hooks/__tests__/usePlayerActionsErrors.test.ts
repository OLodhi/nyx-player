/**
 * usePlayerActions : les boutons du lecteur quand le moteur de lecture répond mal. Un bouton ne doit jamais planter le lecteur ni laisser un affichage faux :
 * le moteur (mpv sous Windows, libmpv sous Android) est imité, aucun flux réel n'est lu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type FullscreenEvent = { data: unknown };

const { mpv, mpvStop, win, android, platform } = vi.hoisted(() => ({
  mpv: {
    setProperty: vi.fn(),
    getProperty: vi.fn(),
    command: vi.fn(),
  },
  mpvStop: vi.fn(),
  win: {
    fullscreen: false,
    resized: null as (() => Promise<void>) | null,
    isFullscreen: vi.fn(),
    setFullscreen: vi.fn(),
    innerSize: vi.fn(),
  },
  android: {
    setFullscreen: vi.fn(),
    observeProperties: vi.fn(),
    listener: null as ((e: FullscreenEvent) => void) | null,
  },
  platform: { android: false },
}));

vi.mock('../../services/player/mpvApi', () => ({
  setProperty: mpv.setProperty,
  getProperty: mpv.getProperty,
  command: mpv.command,
}));
vi.mock('../../services/mpvBridge', () => ({ mpvStop }));
vi.mock('../../services/player/androidPlayer', () => ({
  setFullscreen: android.setFullscreen,
  observeProperties: android.observeProperties,
}));
vi.mock('../../utils/platform', () => ({ isAndroid: () => platform.android }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: (cb: () => Promise<void>) => { win.resized = cb; return Promise.resolve(() => {}); },
    isFullscreen: win.isFullscreen,
    setFullscreen: win.setFullscreen,
    innerSize: win.innerSize,
  }),
}));

import { usePlayerActions } from '../usePlayerActions';

type Mpv = Parameters<typeof usePlayerActions>[0]['mpv'];

function makeMpv(overrides: Partial<Record<string, unknown>> = {}): Mpv {
  return {
    isPaused: false,
    isMuted: false,
    duration: 100,
    currentTime: 50,
    currentTimeRef: { current: 50 },
    durationRef: { current: 100 },
    timePosUpdatesRef: { current: 3 },
    seekTimeoutRef: { current: null },
    volumeRef: { current: 100 },
    setCurrentTime: vi.fn(),
    setIsSeeking: vi.fn(),
    setIsMuted: vi.fn(),
    ...overrides,
  } as unknown as Mpv;
}

function progressBar(width = 200, left = 0) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left, width, top: 0, height: 10, right: left + width, bottom: 10, x: left, y: 0, toJSON: () => ({}) });
  return { current: el };
}

function setup(mpvState: Mpv = makeMpv(), extra: { onClose?: () => void; save?: () => Promise<void> | undefined; progress?: { current: HTMLDivElement | null } } = {}) {
  const onClose = extra.onClose ?? vi.fn();
  const hook = renderHook(() => usePlayerActions({
    mpv: mpvState,
    prefs: { savePlaybackPosition: extra.save ?? (() => undefined) },
    onClose,
    progressRef: (extra.progress ?? { current: null }) as React.RefObject<HTMLDivElement>,
  }));
  return { ...hook, onClose, mpv: mpvState };
}

const click = (clientX: number) => ({ clientX }) as unknown as React.MouseEvent<HTMLDivElement>;
const refused = () => Promise.reject(new Error('moteur de lecture indisponible'));

describe('usePlayerActions : erreurs du moteur de lecture', () => {
  beforeEach(() => {
    platform.android = false;
    win.fullscreen = false;
    win.resized = null;
    mpv.setProperty.mockReset().mockResolvedValue(undefined);
    mpv.getProperty.mockReset().mockResolvedValue(null);
    mpv.command.mockReset().mockResolvedValue(undefined);
    mpvStop.mockReset().mockResolvedValue(undefined);
    win.isFullscreen.mockReset().mockImplementation(async () => win.fullscreen);
    win.setFullscreen.mockReset().mockImplementation(async (v: boolean) => { win.fullscreen = v; });
    win.innerSize.mockReset().mockResolvedValue({ width: 1920, height: 800 });
    android.setFullscreen.mockReset().mockResolvedValue(undefined);
    android.listener = null;
    android.observeProperties.mockReset().mockImplementation(async (_p: string[], cb: (e: FullscreenEvent) => void) => {
      android.listener = cb;
      return () => {};
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Lecture / Pause', () => {
    it('envoie l\'état inverse de l\'affichage', async () => {
      const { result } = setup(makeMpv({ isPaused: true }));
      await act(async () => { await result.current.togglePlayPause(); });
      expect(mpv.setProperty).toHaveBeenCalledWith('pause', false);
    });

    it('moteur qui refuse : pas de plantage, l\'erreur est journalisée', async () => {
      mpv.setProperty.mockImplementation(refused);
      const { result } = setup();
      await act(async () => { await expect(result.current.togglePlayPause()).resolves.toBeUndefined(); });
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Barre de progression', () => {
    it('durée inconnue (direct, chargement) : un clic ne déplace rien', async () => {
      const { result } = setup(makeMpv({ duration: 0 }), { progress: progressBar() });
      await act(async () => { await result.current.handleSeek(click(100)); });
      expect(mpv.command).not.toHaveBeenCalled();
    });

    it('sans barre montée : aucun déplacement', async () => {
      const { result } = setup();
      await act(async () => { await result.current.handleSeek(click(100)); });
      expect(mpv.command).not.toHaveBeenCalled();
    });

    it('clic au milieu : va à la moitié, clic hors de la barre : borné au début ou à la fin', async () => {
      const m = makeMpv();
      const { result } = setup(m, { progress: progressBar(200, 100) });
      await act(async () => { await result.current.handleSeek(click(200)); });
      expect(mpv.command).toHaveBeenLastCalledWith('seek', ['50', 'absolute']);
      await act(async () => { await result.current.handleSeek(click(0)); });
      expect(mpv.command).toHaveBeenLastCalledWith('seek', ['0', 'absolute']);
      await act(async () => { await result.current.handleSeek(click(900)); });
      expect(mpv.command).toHaveBeenLastCalledWith('seek', ['100', 'absolute']);
      expect(m.setIsSeeking).toHaveBeenCalledWith(true);
    });

    it('déplacement refusé : l\'indicateur de chargement ne reste pas affiché', async () => {
      vi.useFakeTimers();
      mpv.command.mockImplementation(refused);
      const m = makeMpv();
      const { result } = setup(m, { progress: progressBar() });
      await act(async () => { await result.current.handleSeek(click(50)); });
      expect(m.setIsSeeking).toHaveBeenLastCalledWith(false);
      // Aucun minuteur de fin de déplacement programmé
      expect(vi.getTimerCount()).toBe(0);
    });

    it('flux qui ne repart jamais après le déplacement : chargement retiré au bout de 10 s', async () => {
      vi.useFakeTimers();
      const m = makeMpv();
      const { result } = setup(m, { progress: progressBar() });
      await act(async () => { await result.current.handleSeek(click(50)); });
      expect(m.setIsSeeking).toHaveBeenLastCalledWith(true);
      expect(m.timePosUpdatesRef.current).toBe(0);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(m.setIsSeeking).toHaveBeenLastCalledWith(false);
    });
  });

  describe('Recul / avance de 10 s', () => {
    it('borné au début et à la fin de la vidéo', async () => {
      const early = makeMpv({ currentTimeRef: { current: 4 } });
      const { result } = setup(early);
      await act(async () => { await result.current.skip(-10); });
      expect(early.setCurrentTime).toHaveBeenCalledWith(0);

      const late = makeMpv({ currentTimeRef: { current: 95 } });
      const second = setup(late);
      await act(async () => { await second.result.current.skip(10); });
      expect(late.setCurrentTime).toHaveBeenCalledWith(100);
    });

    it('saut refusé : l\'indicateur de chargement disparaît', async () => {
      mpv.command.mockImplementation(refused);
      const m = makeMpv();
      const { result } = setup(m);
      await act(async () => { await result.current.skip(10); });
      expect(m.setIsSeeking).toHaveBeenLastCalledWith(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Volume et sourdine', () => {
    const change = (value: string) => ({ target: { value } }) as React.ChangeEvent<HTMLInputElement>;

    it('volume à 0 : ne touche pas à la sourdine ; au-dessus : rétablit le son', async () => {
      const m = makeMpv();
      const { result } = setup(m);
      await act(async () => { await result.current.handleVolumeChange(change('0')); });
      expect(mpv.setProperty).toHaveBeenCalledWith('volume', 0);
      expect(mpv.setProperty).not.toHaveBeenCalledWith('mute', false);
      expect(m.volumeRef.current).toBe(0);

      await act(async () => { await result.current.handleVolumeChange(change('35')); });
      expect(mpv.setProperty).toHaveBeenCalledWith('mute', false);
      expect(m.setIsMuted).toHaveBeenCalledWith(false);
    });

    it('état de la sourdine illisible : bascule depuis l\'affichage', async () => {
      mpv.getProperty.mockImplementation(refused);
      const m = makeMpv({ isMuted: true });
      const { result } = setup(m);
      await act(async () => { await result.current.toggleMute(); });
      expect(mpv.setProperty).toHaveBeenCalledWith('mute', false);
      expect(m.setIsMuted).toHaveBeenCalledWith(false);
    });

    it('sourdine refusée par le moteur : l\'icône ne change pas', async () => {
      mpv.getProperty.mockResolvedValue(false);
      mpv.setProperty.mockImplementation(refused);
      const m = makeMpv();
      const { result } = setup(m);
      await act(async () => { await result.current.toggleMute(); });
      expect(m.setIsMuted).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Plein écran', () => {
    it('Windows : bascule la fenêtre et suit son état', async () => {
      const { result } = setup();
      await act(async () => { await result.current.toggleFullscreen(); });
      expect(win.setFullscreen).toHaveBeenCalledWith(true);
      expect(result.current.isFullscreen).toBe(true);
    });

    it('Windows : fenêtre qui refuse, l\'icône reste la même', async () => {
      win.setFullscreen.mockImplementation(refused);
      const { result } = setup();
      await act(async () => { await result.current.toggleFullscreen(); });
      expect(result.current.isFullscreen).toBe(false);
    });

    it('Android : part en plein écran, bascule par le plugin, et suit les changements venus d\'ailleurs', async () => {
      platform.android = true;
      const { result } = setup();
      expect(result.current.isFullscreen).toBe(true);
      await act(async () => { await result.current.toggleFullscreen(); });
      expect(android.setFullscreen).toHaveBeenCalledWith(false);
      expect(result.current.isFullscreen).toBe(false);

      act(() => { android.listener?.({ data: true }); });
      expect(result.current.isFullscreen).toBe(true);
    });

    it('Android : plugin qui refuse, l\'icône ne change pas ; suivi impossible, pas de plantage', async () => {
      platform.android = true;
      android.setFullscreen.mockImplementation(refused);
      android.observeProperties.mockImplementation(refused);
      const { result } = setup();
      await act(async () => { await result.current.toggleFullscreen(); });
      expect(result.current.isFullscreen).toBe(true);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('Format de l\'image', () => {
    it('cycle Ajuster → Remplir → Étirer → Ajuster', async () => {
      const { result } = setup();
      expect(result.current.aspectMode).toBe('fit');
      await act(async () => { await result.current.toggleAspect(); });
      expect(result.current.aspectMode).toBe('fill');
      expect(mpv.setProperty).toHaveBeenLastCalledWith('panscan', 1);

      await act(async () => { await result.current.toggleAspect(); });
      expect(result.current.aspectMode).toBe('stretch');
      expect(mpv.setProperty).toHaveBeenCalledWith('video-aspect-override', String(1920 / 800));

      await act(async () => { await result.current.toggleAspect(); });
      expect(result.current.aspectMode).toBe('fit');
      expect(mpv.setProperty).toHaveBeenLastCalledWith('video-aspect-override', '-1');
    });

    it('Étirer : suit le redimensionnement de la fenêtre, pas dans les autres modes', async () => {
      const { result } = setup();
      await act(async () => { await win.resized?.(); });
      expect(mpv.setProperty).not.toHaveBeenCalled();

      await act(async () => { await result.current.toggleAspect(); });
      await act(async () => { await result.current.toggleAspect(); });
      win.innerSize.mockResolvedValue({ width: 1000, height: 500 });
      await act(async () => { await win.resized?.(); });
      expect(mpv.setProperty).toHaveBeenLastCalledWith('video-aspect-override', '2');
    });

    it('moteur qui refuse : le mode affiché ne change pas', async () => {
      mpv.setProperty.mockImplementation(refused);
      const { result } = setup();
      await act(async () => { await result.current.toggleAspect(); });
      expect(result.current.aspectMode).toBe('fit');
    });
  });

  describe('Fermeture', () => {
    it('moteur en panne (format, arrêt, son) : le lecteur se ferme quand même', async () => {
      vi.useFakeTimers();
      mpv.setProperty.mockImplementation(refused);
      mpvStop.mockImplementation(refused);
      const { result, onClose } = setup();
      act(() => { void result.current.handleClose(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('sauvegarde de la position qui plante tout de suite : le lecteur se ferme quand même', async () => {
      vi.useFakeTimers();
      const { result, onClose } = setup(makeMpv(), { save: () => { throw new Error('SQLite occupée'); } });
      act(() => { void result.current.handleClose(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Windows en plein écran : quitte le plein écran, remet le format et rend le son', async () => {
      vi.useFakeTimers();
      win.fullscreen = true;
      const { result, onClose } = setup();
      act(() => { void result.current.handleClose(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(win.setFullscreen).toHaveBeenCalledWith(false);
      expect(mpv.setProperty).toHaveBeenCalledWith('panscan', 0);
      expect(mpv.setProperty).toHaveBeenCalledWith('mute', false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fenêtre bloquée en quittant le plein écran : fermeture après 500 ms au plus', async () => {
      vi.useFakeTimers();
      win.isFullscreen.mockImplementation(() => new Promise(() => {}));
      const { result, onClose } = setup();
      act(() => { void result.current.handleClose(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('Android : ne touche pas à la fenêtre (le plugin restaure l\'écran à l\'arrêt)', async () => {
      vi.useFakeTimers();
      platform.android = true;
      const { result, onClose } = setup();
      act(() => { void result.current.handleClose(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(600); });
      expect(win.isFullscreen).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
