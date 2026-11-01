/**
 * Rail sous React : créé, détruit puis recréé par le mode strict, et remplacé en passant de Films à Séries ; le
 * défilement de la page n'est joué par le compositeur que tant qu'un rail est affiché.
 */
import React, { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import RecycledRail from '../RecycledRail';
import type { RailSource } from '../rail';
import { animateScrollTo, cancelAllScrolls } from '../../../../utils/spatialNavigation/scrollAnimator';
import { setTvMode } from '../../../../utils/platform';

vi.mock('../../../../hooks/useWatchlistKeys', () => ({ currentWatchlistKeys: () => null, onWatchlistKeys: () => () => undefined }));
// Vrai rail, dont on note ce qu'il reçoit pour l'accueil caché
const covered = vi.hoisted(() => [] as boolean[]);
vi.mock('../rail', async (importOriginal) => {
  const original = await importOriginal<typeof import('../rail')>();
  return {
    ...original,
    createRail: (...args: Parameters<typeof original.createRail>) => {
      const rail = original.createRail(...args);
      return { ...rail, setCovered: (next: boolean) => { covered.push(next); rail.setCovered(next); } };
    },
  };
});

class Inert {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

const source: RailSource = (key) => ({ title: key, items: [], watchlistLabel: '' });

let page: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.stubGlobal('IntersectionObserver', Inert);
  vi.stubGlobal('ResizeObserver', Inert);
  vi.stubGlobal('CSS', { supports: (property: string) => property === 'translate' });
  // jsdom ne connaît pas les animations Web : une animation inerte suffit pour savoir qui joue le défilement.
  Element.prototype.animate = vi.fn(() => ({ currentTime: 0, cancel() {} }) as unknown as Animation);
  setTvMode(true);
  page = document.createElement('div');
  page.style.overflowY = 'auto';
  Object.defineProperty(page, 'scrollHeight', { value: 5000 });
  Object.defineProperty(page, 'clientHeight', { value: 720 });
  let position = 0;
  Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
  document.body.appendChild(page);
});

afterEach(() => {
  cancelAllScrolls();
  setTvMode(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (Element.prototype as Partial<Element>).animate;
  document.body.innerHTML = '';
});

const Home: React.FC<{ mode: string }> = ({ mode }) => <RecycledRail key={mode} rows={[`${mode}-a`, `${mode}-b`]} source={source} />;

describe('rail sous React', () => {
  it('mode strict, puis Films → Séries : un seul jeu d\'emplacements, le compositeur tenu jusqu\'au départ du dernier rail', () => {
    const view = render(<StrictMode><Home mode="films" /></StrictMode>, { container: page });
    expect(page.querySelectorAll('.rail-place')).toHaveLength(2);
    expect(page.querySelectorAll('.rail-layer')).toHaveLength(1);
    view.rerender(<StrictMode><Home mode="series" /></StrictMode>);
    expect(Array.from(page.querySelectorAll('.rail-place'))).toHaveLength(2);
    expect(page.querySelectorAll('.rail-layer')).toHaveLength(1);
    animateScrollTo(page, { top: 600 });
    expect(page.scrollTop).toBe(600);
    view.unmount();
    animateScrollTo(page, { top: 1200 });
    expect(page.scrollTop).toBeLessThan(1200);
  });

  it('accueil caché par une fiche puis rendu : le rail le sait', () => {
    covered.length = 0;
    const view = render(<RecycledRail rows={['a']} source={source} />, { container: page });
    view.rerender(<RecycledRail rows={['a']} source={source} covered />);
    view.rerender(<RecycledRail rows={['a']} source={source} covered={false} />);
    expect(covered).toEqual([false, true, false]);
    view.unmount();
  });
});
