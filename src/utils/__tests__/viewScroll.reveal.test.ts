/**
 * Bas vers une rangée pas encore montée : la page défile un peu pour la faire monter, puis on retente. En défilement
 * animé léger (TV), la rangée se monte à la fin du mouvement en cours : on l'attend au lieu de couper le
 * mouvement et de sauter d'une demi-page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const findNext = vi.fn<(from: HTMLElement, direction: string) => HTMLElement | null>(() => null);
vi.mock('../spatialNavigation/findNext', () => ({ findNextFocusable: (from: HTMLElement, d: string) => findNext(from, d) }));

import { cancelReveal, revealAndRetry } from '../spatialNavigation/viewScroll';
import {
  animateScrollTo,
  cancelAllScrolls,
  DEFERRED_MOUNT_MAX_MS,
} from '../spatialNavigation/scrollAnimator';
import { setTvMode } from '../platform';

const FRAME_MS = 16;

function page() {
  const parent = document.createElement('div');
  parent.style.overflowY = 'auto';
  let position = 0;
  Object.defineProperty(parent, 'scrollTop', { get: () => position, set: (v: number) => (position = v) });
  Object.defineProperty(parent, 'scrollHeight', { value: 5000 });
  Object.defineProperty(parent, 'clientHeight', { value: 720 });
  const scrollBy = vi.fn((options: ScrollToOptions) => (position += options.top ?? 0));
  parent.scrollBy = scrollBy as unknown as typeof parent.scrollBy;
  const card = document.createElement('button');
  card.getBoundingClientRect = () => ({ top: 600, bottom: 700 }) as DOMRect;
  parent.getBoundingClientRect = () => ({ top: 0, bottom: 720 }) as DOMRect;
  parent.appendChild(card);
  document.body.appendChild(parent);
  card.focus();
  return { parent, card, scrollBy };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  findNext.mockClear();
});
afterEach(() => {
  cancelReveal();
  setTvMode(false);
  cancelAllScrolls();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Bas vers une rangée pas encore montée', () => {
  it('hors TV : le mouvement en cours est arrêté et la page avance d’un pas tout de suite', () => {
    const { parent, card, scrollBy } = page();
    animateScrollTo(parent, { top: 400 });
    revealAndRetry(card, 'down');
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('TV, défilement léger : le mouvement continue, aucun saut ; on retente après sa fin', () => {
    setTvMode(true);
    const { parent, card, scrollBy } = page();
    animateScrollTo(parent, { top: 400 });
    revealAndRetry(card, 'down');
    expect(scrollBy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FRAME_MS);
    expect(parent.scrollTop).toBeGreaterThan(0);
    expect(parent.scrollTop).toBeLessThan(400);
    expect(findNext).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEFERRED_MOUNT_MAX_MS + 200);
    expect(findNext).toHaveBeenCalledWith(card, 'down');
  });

  it('TV, défilement léger : une autre flèche entre-temps annule la nouvelle tentative', () => {
    setTvMode(true);
    const { parent, card } = page();
    animateScrollTo(parent, { top: 400 });
    revealAndRetry(card, 'down');
    cancelReveal();
    vi.advanceTimersByTime(DEFERRED_MOUNT_MAX_MS + 500);
    expect(findNext).not.toHaveBeenCalled();
  });
});
