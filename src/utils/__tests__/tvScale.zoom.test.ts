/**
 * tvScale : cas limites de la page TV et zoom de la fenêtre Windows (mode TV de développement).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  isAndroid: vi.fn(() => false),
  setZoom: vi.fn(() => Promise.resolve()),
  getCurrentWebview: vi.fn(),
}));
vi.mock('../platform', () => ({ isAndroid: h.isAndroid }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: h.getCurrentWebview }));

import { applyTvViewport, zoomForWindow, installDesktopTvZoom, resetDesktopZoom } from '../tvScale';

const win = window as unknown as { __TAURI_INTERNALS__?: unknown };
const setScreen = (w: number, hgt: number) => {
  Object.defineProperty(window.screen, 'width', { value: w, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: hgt, configurable: true });
};
const setInner = (w: number, hgt: number) => {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: hgt, configurable: true });
};

/** Écouteurs posés par le code testé, retirés après chaque test pour qu'un test ne voie que le sien. */
const resizeListeners: Array<[string, EventListener]> = [];

beforeEach(() => {
  vi.clearAllMocks();
  const realAdd = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, cb: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) => {
    if (type === 'resize') resizeListeners.push([type, cb as EventListener]);
    realAdd(type, cb, opts);
  });
  h.isAndroid.mockReturnValue(false);
  h.getCurrentWebview.mockReturnValue({ setZoom: h.setZoom });
  h.setZoom.mockResolvedValue(undefined);
  delete win.__TAURI_INTERNALS__;
  document.head.innerHTML = '<meta name="viewport" content="width=device-width" />';
  document.documentElement.style.removeProperty('--tv-canvas-h');
});
afterEach(() => {
  delete win.__TAURI_INTERNALS__;
  for (const [type, cb] of resizeListeners) window.removeEventListener(type, cb);
  resizeListeners.length = 0;
  vi.restoreAllMocks();
});

describe('applyTvViewport - cas limites', () => {
  it('ne fait rien sans balise viewport', () => {
    document.head.innerHTML = '';
    setScreen(960, 540);
    expect(() => applyTvViewport()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue('--tv-canvas-h')).toBe('');
  });

  it('ne touche pas la balise quand la largeur d\'écran est inconnue (0)', () => {
    setScreen(0, 0);
    applyTvViewport();
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toBe('width=device-width');
  });

  it('box 720p : échelle 1,0000 et toile de 720 px de haut', () => {
    setScreen(1280, 720);
    applyTvViewport();
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain('initial-scale=1.0000');
    expect(document.documentElement.style.getPropertyValue('--tv-canvas-h')).toBe('720px');
  });

  it('écran 16:10 : l\'échelle suit la largeur et la toile grandit en hauteur (800 px)', () => {
    setScreen(1280, 800);
    applyTvViewport();
    expect(document.documentElement.style.getPropertyValue('--tv-canvas-h')).toBe('800px');
  });

  it('écran large mais bas : l\'échelle suit la hauteur', () => {
    setScreen(1920, 540);
    applyTvViewport();
    // 540 / 720 = 0,75 < 1920 / 1280 = 1,5
    expect(document.querySelector('meta[name="viewport"]')?.getAttribute('content')).toContain('initial-scale=0.7500');
  });
});

describe('zoomForWindow', () => {
  it('prend le côté le plus contraignant', () => {
    expect(zoomForWindow(640, 720)).toBe(0.5);
    expect(zoomForWindow(2560, 720)).toBe(1);
  });
});

describe('installDesktopTvZoom', () => {
  it('ne fait rien hors de Tauri (aperçu navigateur)', async () => {
    await installDesktopTvZoom();
    expect(h.getCurrentWebview).not.toHaveBeenCalled();
  });

  it('ne fait rien sur Android, où la balise viewport suffit', async () => {
    win.__TAURI_INTERNALS__ = {};
    h.isAndroid.mockReturnValue(true);
    await installDesktopTvZoom();
    expect(h.getCurrentWebview).not.toHaveBeenCalled();
  });

  it('règle le zoom pour que la toile tienne dans la fenêtre', async () => {
    win.__TAURI_INTERNALS__ = {};
    setInner(2560, 1440);
    await installDesktopTvZoom();
    expect(h.setZoom).toHaveBeenCalledWith(2);
  });

  it('ne rappelle pas la WebView quand le zoom est déjà bon (écart < 0,005)', async () => {
    win.__TAURI_INTERNALS__ = {};
    setInner(1280, 720);
    await installDesktopTvZoom();
    expect(h.setZoom).not.toHaveBeenCalled();
  });

  it('recalcule en tenant compte du zoom déjà appliqué quand la fenêtre change', async () => {
    win.__TAURI_INTERNALS__ = {};
    setInner(2560, 1440);
    await installDesktopTvZoom();
    expect(h.setZoom).toHaveBeenLastCalledWith(2);
    // La page voit 1280 px (2560 / 2) ; la fenêtre réelle passe à 1920 x 1080 -> page 960 x 540
    setInner(960, 540);
    window.dispatchEvent(new Event('resize'));
    expect(h.setZoom).toHaveBeenLastCalledWith(1.5);
  });

  it('ignore une taille de fenêtre nulle', async () => {
    win.__TAURI_INTERNALS__ = {};
    setInner(0, 0);
    await installDesktopTvZoom();
    expect(h.setZoom).not.toHaveBeenCalled();
  });

  it('survit à un refus de la WebView', async () => {
    win.__TAURI_INTERNALS__ = {};
    setInner(2560, 1440);
    h.setZoom.mockRejectedValueOnce(new Error('refusé'));
    await expect(installDesktopTvZoom()).resolves.toBeUndefined();
  });

  it('ne plante pas si l\'API webview est indisponible', async () => {
    win.__TAURI_INTERNALS__ = {};
    h.getCurrentWebview.mockImplementationOnce(() => { throw new Error('absent'); });
    await expect(installDesktopTvZoom()).resolves.toBeUndefined();
    expect(h.setZoom).not.toHaveBeenCalled();
  });
});

describe('resetDesktopZoom', () => {
  it('remet le zoom à 1 sous Tauri bureau', async () => {
    win.__TAURI_INTERNALS__ = {};
    await resetDesktopZoom();
    expect(h.setZoom).toHaveBeenCalledWith(1);
  });

  it('ne fait rien hors de Tauri', async () => {
    await resetDesktopZoom();
    expect(h.setZoom).not.toHaveBeenCalled();
  });

  it('ne lève pas d\'erreur si la WebView refuse', async () => {
    win.__TAURI_INTERNALS__ = {};
    h.setZoom.mockRejectedValueOnce(new Error('refusé'));
    await expect(resetDesktopZoom()).resolves.toBeUndefined();
  });
});
