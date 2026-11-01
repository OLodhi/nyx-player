/**
 * Guide TV virtualisé : seules les chaînes et les heures à l'écran (plus une marge) sont dessinées.
 *
 * Défaut (Chromecast) : une grosse catégorie dessinait ≈ 7 000 éléments, toutes les
 * chaînes et tous les programmes de la journée ; 39 % d'images en retard et ≈ 4 s à l'ouverture.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { GuideTvGrid } from '../GuideTvGrid';
import { installSpatialNavigation } from '../../../utils/spatialNavigation';
import { setTvMode } from '../../../utils/platform';
import type { IptvStream } from '../../../types/iptv';
import type { EpgProgram } from '../../../services/epgService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const H = 3600;
const ORIGIN = 1_790_000_000 - (1_790_000_000 % 86400); // minuit UTC
const NOW = ORIGIN + 20.25 * H; // 20 h 15
/** Mise en page simulée : rangées de 64 px, 4 px par minute (rem de 16 px), corps de 1100 × 560 */
const ROW_PX = 64;
const PX_PER_MIN = 4;
const VIEW = { width: 1100, height: 560 };
const CHANNELS = 120;

const channel = (id: number): IptvStream =>
  ({ stream_id: id, name: `Chaîne ${id}`, epg_channel_id: `c${id}` }) as unknown as IptvStream;
/** 48 programmes d'une demi-heure par chaîne */
const dayOf = (id: IptvStream['stream_id']): EpgProgram[] => Array.from({ length: 48 }, (_, i) => ({
  channelId: `c${id}`,
  title: `P${id} ${i / 2}`,
  startTs: ORIGIN + i * 1800,
  stopTs: ORIGIN + (i + 1) * 1800,
}));

const channels = Array.from({ length: CHANNELS }, (_, i) => channel(i + 1));
const allPrograms = () => new Map<string, EpgProgram[]>(channels.map((ch) => [`c${ch.stream_id}`, dayOf(ch.stream_id)]));

// ── Mise en page simulée du corps du guide (jsdom n'en a pas) ──────────────
const scroll = new WeakMap<Element, { top: number; left: number }>();
const isBody = (el: Element) => el instanceof HTMLElement && el.dataset.testid === 'guide-body';
const saved = new Map<string, PropertyDescriptor | undefined>();
function mockLayout() {
  const define = (name: string, descriptor: PropertyDescriptor) => {
    saved.set(name, Object.getOwnPropertyDescriptor(Element.prototype, name)
      ?? Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, ...descriptor });
  };
  define('clientWidth', { get(this: HTMLElement) { return isBody(this) ? VIEW.width : 0; } });
  define('clientHeight', { get(this: HTMLElement) { return isBody(this) ? VIEW.height : 0; } });
  // Tailles du contenu : le défilement conduit (scrollAnimator) borne sa cible à ce que la zone peut défiler
  define('scrollHeight', { get(this: HTMLElement) { return isBody(this) ? CHANNELS * ROW_PX : 0; } });
  define('scrollWidth', { get(this: HTMLElement) { return isBody(this) ? 1440 * PX_PER_MIN : 0; } });
  for (const [name, key] of [['scrollTop', 'top'], ['scrollLeft', 'left']] as const) {
    define(name, {
      get(this: HTMLElement) { return scroll.get(this)?.[key] ?? 0; },
      set(this: HTMLElement, value: number) {
        const current = scroll.get(this) ?? { top: 0, left: 0 };
        scroll.set(this, { ...current, [key]: Math.max(0, value) });
      },
    });
  }
}
function restoreLayout() {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  }
  saved.clear();
}

// Images d'animation : la grille recalcule sa fenêtre à la prochaine image, pas à chaque événement scroll
let frames: Array<() => void> = [];
const nativeRaf = window.requestAnimationFrame;
const nativeCancelRaf = window.cancelAnimationFrame;
const flushFrames = () => {
  const todo = frames;
  frames = [];
  todo.forEach((cb) => cb());
};

/** Fait défiler le corps du guide (la grille suit à l'événement scroll, à l'image suivante). */
function scrollBody(top: number, left?: number) {
  const body = screen.getByTestId('guide-body');
  act(() => {
    body.scrollTop = top;
    if (left !== undefined) body.scrollLeft = left;
    fireEvent.scroll(body);
    flushFrames();
  });
}

function renderGuide(programs = allPrograms(), list = channels) {
  const props = {
    channels: list,
    onChannelClick: vi.fn(),
    programs,
    originTs: ORIGIN,
    totalMinutes: 1440,
    isLoading: false,
    error: null,
    loadDay: vi.fn().mockResolvedValue(undefined),
    loadedDays: new Set([ORIGIN]),
  };
  const view = render(<GuideTvGrid {...props} />);
  return { ...view, props };
}

const rowsOf = (selector: string) => [...document.querySelectorAll<HTMLElement>(selector)].map((el) => Number(el.dataset.guideRow));
const press = (key: string) => {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  });
};
const focusedTitle = () => document.activeElement?.querySelector('.guide-program__title')?.textContent
  ?? document.activeElement?.getAttribute('aria-label');

const nativeScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  Element.prototype.scrollIntoView = vi.fn();
  frames = [];
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => frames.push(() => cb(0))) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  // rem de 16 px (jsdom n'a pas de taille de police calculée)
  document.documentElement.style.fontSize = '16px';
  mockLayout();
});

afterEach(() => {
  restoreLayout();
  document.documentElement.style.fontSize = '';
  vi.useRealTimers();
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  window.requestAnimationFrame = nativeRaf;
  window.cancelAnimationFrame = nativeCancelRaf;
});

describe('GuideTvGrid virtualisé', () => {
  it("ne dessine que les chaînes et les heures autour de l'écran", () => {
    renderGuide();
    const programs = document.querySelectorAll('[data-testid="guide-program"]');
    // Avant : 120 × 48 = 5 760 programmes, 120 logos
    expect(programs.length).toBeLessThan(400);
    expect(document.querySelectorAll('[data-testid="guide-channel"]').length).toBeLessThan(25);
    // L'écran est calé sur maintenant (20 h 15) : le programme en cours de la première chaîne est là
    expect(document.querySelector('[data-guide-row="0"].guide-program--live')?.textContent).toContain('P1 20');
    // Rien du matin, loin de l'écran
    expect(document.querySelector(`[data-guide-row="0"][data-guide-start="${ORIGIN + 8 * H}"]`)).toBeNull();
  });

  it('plusieurs événements de défilement dans la même image ne recalculent la fenêtre qu\'une fois', () => {
    renderGuide();
    const body = screen.getByTestId('guide-body');
    const avant = frames.length;
    act(() => {
      for (let i = 1; i <= 5; i++) {
        body.scrollTop = i * 10 * ROW_PX;
        fireEvent.scroll(body);
      }
    });
    expect(frames.length - avant).toBe(1);
    // Rien n'est redessiné avant l'image suivante
    expect(rowsOf('[data-testid="guide-channel"]')).not.toContain(50);
    act(() => flushFrames());
    expect(rowsOf('[data-testid="guide-channel"]')).toContain(50);
  });

  it('les cales gardent la hauteur de la grille entière', () => {
    renderGuide();
    scrollBody(60 * ROW_PX);
    const rows = rowsOf('[data-testid="guide-channel"]');
    const spacers = [...document.querySelectorAll<HTMLElement>('.guide-tv-grid__channels > .guide-tv-grid__spacer')];
    const spacerRows = spacers.map((s) => Number(/calc\((\d+) \*/.exec(s.style.height)?.[1]));
    expect(spacerRows[0]).toBe(rows[0]);
    expect(spacerRows[0] + rows.length + spacerRows[1]).toBe(CHANNELS);
    expect(rows).toContain(60);
    expect(rows).not.toContain(0);
  });

  it('en défilant, les chaînes et les heures à l\'écran apparaissent', () => {
    renderGuide();
    scrollBody(100 * ROW_PX, 3 * 60 * PX_PER_MIN); // chaîne 101, 3 h du matin
    expect(document.querySelector(`[data-guide-row="100"][data-guide-start="${ORIGIN + 3 * H}"]`)).not.toBeNull();
    expect(document.querySelector('[data-guide-row="0"]')).toBeNull();
  });

  it('hors TV, un clic sur un logo dessiné lance la chaîne', () => {
    const { props } = renderGuide();
    scrollBody(50 * ROW_PX);
    fireEvent.click(screen.getByLabelText('Chaîne 51', { selector: '[data-testid="guide-channel"]' }));
    expect(props.onChannelClick).toHaveBeenCalledWith(channels[50]);
  });

  describe('à la télécommande', () => {
    let uninstall: () => void = () => {};
    let followSelection = true;
    const followFocus = (event: FocusEvent) => {
      if (!followSelection) return;
      const row = Number((event.target as HTMLElement).dataset?.guideRow);
      const body = document.querySelector<HTMLElement>('[data-testid="guide-body"]');
      if (!body || Number.isNaN(row)) return;
      body.scrollTop = row * ROW_PX - VIEW.height / 2;
      fireEvent.scroll(body);
      flushFrames();
    };
    beforeEach(() => {
      setTvMode(true);
      uninstall = installSpatialNavigation();
      // La vue suit la sélection, comme sur l'appareil : la case est centrée verticalement
      // (jsdom ne défile pas : le défilement conduit, lui, est testé dans scrollAnimator.test.ts)
      followSelection = true;
      document.addEventListener('focusin', followFocus);
    });
    afterEach(() => {
      document.removeEventListener('focusin', followFocus);
      uninstall();
      setTvMode(false);
    });

    it('Bas, 40 fois sans que la vue suive : chaque case visée est dessinée puis sélectionnée', () => {
      followSelection = false;
      renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      for (let i = 0; i < 40; i++) press('ArrowDown');
      expect(focusedTitle()).toBe('P41 20');
      expect(document.activeElement?.isConnected).toBe(true);
      expect(document.querySelectorAll('[data-guide-row][tabindex="0"]')).toHaveLength(1);
    });

    it('Droite au-delà des heures dessinées : la case suivante est dessinée puis sélectionnée', () => {
      renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      // La vue part sur le matin (souris de la télécommande), la sélection reste à 20 h
      scrollBody(0, 8 * 60 * PX_PER_MIN);
      expect(document.querySelector(`[data-guide-row="0"][data-guide-start="${ORIGIN + 20.5 * H}"]`)).toBeNull();
      press('ArrowRight');
      expect(focusedTitle()).toBe('P1 20.5');
      press('ArrowRight');
      expect(focusedTitle()).toBe('P1 21');
    });

    it('la case sélectionnée reste dessinée quand la vue part loin', () => {
      renderGuide();
      const entry = document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement;
      act(() => entry.focus());
      scrollBody(110 * ROW_PX, 2 * 60 * PX_PER_MIN);
      expect(entry.isConnected).toBe(true);
      expect(document.activeElement).toBe(entry);
      expect(document.querySelector('[data-guide-row="110"]')).not.toBeNull();
    });

    it('reprise après un rechargement sur une chaîne loin du haut', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      for (let i = 0; i < 90; i++) press('ArrowDown');
      expect(focusedTitle()).toBe('P91 20');
      view.rerender(<GuideTvGrid {...view.props} isLoading />);
      view.rerender(<GuideTvGrid {...view.props} programs={allPrograms()} />);
      expect(focusedTitle()).toBe('P91 20');
      expect(document.querySelectorAll('[data-guide-row][tabindex="0"]')).toHaveLength(1);
    });

    it('un jour précédent chargé en tête ne recrée pas la case sélectionnée, loin du haut', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      for (let i = 0; i < 50; i++) press('ArrowDown');
      const focused = document.activeElement;
      expect(focusedTitle()).toBe('P51 20');
      const programs = allPrograms();
      programs.set('c51', [{ channelId: 'c51', title: 'veille', startTs: ORIGIN - 2 * H, stopTs: ORIGIN - H }, ...programs.get('c51')!]);
      view.rerender(<GuideTvGrid {...view.props} programs={programs} loadedDays={new Set([ORIGIN - 86400, ORIGIN])} />);
      expect(document.activeElement).toBe(focused);
      expect(focused?.isConnected).toBe(true);
    });

    it('autre catégorie : on repart du programme en cours de la première chaîne', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      for (let i = 0; i < 30; i++) press('ArrowDown');
      const bar = document.createElement('button');
      document.body.appendChild(bar);
      act(() => bar.focus());
      view.rerender(<GuideTvGrid {...view.props} isLoading />);
      view.rerender(<GuideTvGrid {...view.props} channels={channels.slice(0, 60)} programs={allPrograms()} />);
      bar.remove();
      const entries = document.querySelectorAll('[data-guide-row][tabindex="0"]');
      expect(entries).toHaveLength(1);
      expect(entries[0].textContent).toContain('P1 20');
      // Rien de la catégorie d'avant n'oblige à dessiner loin
      expect(document.querySelectorAll('[data-testid="guide-channel"]').length).toBeLessThan(25);
    });
  });
});
