/**
 * installViewportHeightVar : variable CSS --nyx-viewport-h et classe nyx-keyboard-open.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installViewportHeightVar } from '../viewportHeight';

type Listener = () => void;

/** Faux window.visualViewport : dimensions réglables et écouteurs enregistrés. */
function fakeViewport(width: number, height: number) {
  const listeners = new Map<string, Set<Listener>>();
  const vp = {
    width,
    height,
    addEventListener: (type: string, cb: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: Listener) => { listeners.get(type)?.delete(cb); },
    emit: (type: string) => listeners.get(type)?.forEach((cb) => cb()),
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
  return vp;
}

const root = document.documentElement;
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

function setViewport(vp: unknown) {
  Object.defineProperty(window, 'visualViewport', { value: vp, configurable: true });
}

beforeEach(() => {
  root.style.removeProperty('--nyx-viewport-h');
  root.classList.remove('nyx-keyboard-open');
  document.body.innerHTML = '';
});
afterEach(() => {
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as unknown as Record<string, unknown>).visualViewport;
  document.body.innerHTML = '';
});

describe('installViewportHeightVar avec visualViewport', () => {
  it('pose la hauteur visible arrondie dès l\'installation', () => {
    setViewport(fakeViewport(360, 731.6));
    const off = installViewportHeightVar();
    expect(root.style.getPropertyValue('--nyx-viewport-h')).toBe('732px');
    off();
  });

  it('met la variable à jour quand la hauteur change', () => {
    const vp = fakeViewport(360, 732);
    setViewport(vp);
    const off = installViewportHeightVar();
    vp.height = 400;
    vp.emit('resize');
    expect(root.style.getPropertyValue('--nyx-viewport-h')).toBe('400px');
    off();
  });

  it('signale le clavier quand la fenêtre rétrécit avec un champ de saisie actif', () => {
    const vp = fakeViewport(360, 732);
    setViewport(vp);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const off = installViewportHeightVar();
    expect(root.classList.contains('nyx-keyboard-open')).toBe(false);
    vp.height = 420;
    vp.emit('resize');
    expect(root.classList.contains('nyx-keyboard-open')).toBe(true);
    vp.height = 732;
    vp.emit('resize');
    expect(root.classList.contains('nyx-keyboard-open')).toBe(false);
    off();
  });

  it('ne signale pas de clavier sans champ de saisie actif (écran partagé)', () => {
    const vp = fakeViewport(360, 732);
    setViewport(vp);
    const off = installViewportHeightVar();
    vp.height = 420;
    vp.emit('resize');
    expect(root.classList.contains('nyx-keyboard-open')).toBe(false);
    off();
  });

  it('reconnaît aussi une zone de texte comme champ de saisie', () => {
    const vp = fakeViewport(360, 732);
    setViewport(vp);
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    area.focus();
    const off = installViewportHeightVar();
    vp.height = 420;
    vp.emit('scroll');
    expect(root.classList.contains('nyx-keyboard-open')).toBe(true);
    off();
  });

  it('retire ses écouteurs au démontage', () => {
    const vp = fakeViewport(360, 732);
    setViewport(vp);
    const off = installViewportHeightVar();
    expect(vp.count('resize')).toBe(1);
    expect(vp.count('scroll')).toBe(1);
    off();
    expect(vp.count('resize')).toBe(0);
    expect(vp.count('scroll')).toBe(0);
  });
});

describe('installViewportHeightVar sans visualViewport', () => {
  it('lit window.innerHeight et suit l\'événement resize de la fenêtre', () => {
    setViewport(undefined);
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 640, configurable: true });
    const off = installViewportHeightVar();
    expect(root.style.getPropertyValue('--nyx-viewport-h')).toBe('640px');
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--nyx-viewport-h')).toBe('500px');
    off();
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--nyx-viewport-h')).toBe('500px');
  });
});
