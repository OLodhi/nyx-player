/**
 * Catégories des modes Films et Séries sur bureau et téléphone : montées à l'approche de l'écran, retirées en
 * s'éloignant. Sur TV, ces modes passent par le rail recyclé (components/Iptv/rail).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LazyCategory from '../LazyCategory';
import { animateScrollTo, cancelAllScrolls } from '../../../utils/spatialNavigation/scrollAnimator';

let observe: IntersectionObserverCallback | null = null;
class FakeObserver {
  constructor(callback: IntersectionObserverCallback) {
    observe = callback;
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
}

const intersect = (isIntersecting: boolean) =>
  act(() => observe!([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver));
const shown = () => screen.queryByTestId('rangee') !== null;

/** Une page qui défile, animée par le ressort */
function startScroll(): void {
  const page = document.createElement('div');
  document.body.appendChild(page);
  let position = 0;
  Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v) });
  Object.defineProperty(page, 'scrollHeight', { value: 5000 });
  Object.defineProperty(page, 'clientHeight', { value: 720 });
  animateScrollTo(page, { top: 400 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  // Hors de l'écran au départ (jsdom : rectangle nul, considéré visible sinon)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000, bottom: 5300 } as DOMRect);
});
afterEach(() => {
  cancelAllScrolls();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const Category = () => (
  <LazyCategory>
    <div data-testid="rangee" />
  </LazyCategory>
);

describe('LazyCategory', () => {
  it('montée et retirée tout de suite, même en plein défilement', () => {
    render(<Category />);
    startScroll();
    intersect(true);
    expect(shown()).toBe(true);
    intersect(false);
    expect(shown()).toBe(false);
  });
});
