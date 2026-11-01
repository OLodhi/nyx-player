/**
 * Rangées des Suggestions sur bureau et téléphone : montées à l'approche de l'écran, retirées tout de suite à la sortie.
 * Sur TV, les Suggestions passent par le rail recyclé (components/Iptv/rail), jamais par cette rangée.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// Cartes simplifiées : on teste la place et le montage des rangées, pas les cartes
vi.mock('../../Lists/CarouselCard', () => ({
  CarouselCard: ({ item }: { item: { id: string | number; title: string } }) => (
    <button data-testid="card" data-card={item.id}>{item.title}</button>
  ),
}));

// jsdom n'a pas de mise en page : le virtualiseur dessinerait zéro carte. Il en dessine ici toutes.
vi.mock('@tanstack/react-virtual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-virtual')>()),
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * estimateSize() })),
    getTotalSize: () => count * estimateSize(),
    measure: () => {},
  }),
}));

import VirtualDashboardRow from '../VirtualDashboardRow';

type Observer = { callback: IntersectionObserverCallback; element: Element | null; root: unknown };
const observers: Observer[] = [];

class FakeObserver {
  private readonly entry: Observer;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.entry = { callback, element: null, root: options?.root };
    observers.push(this.entry);
  }
  observe(el: Element) { this.entry.element = el; }
  disconnect() { this.entry.element = null; }
  unobserve() {}
  takeRecords() { return []; }
}

/** Dit à l'observateur de la rangée `index` que sa zone est visible ou non. */
const intersect = (title: string, isIntersecting: boolean) => {
  const el = screen.getByTestId(`row-${title}`).querySelector('.virtual-dashboard-row');
  const obs = observers.find((o) => o.element === el);
  if (!obs) throw new Error(`pas d'observateur pour ${title}`);
  act(() => obs.callback([{ isIntersecting } as IntersectionObserverEntry], obs as unknown as IntersectionObserver));
};

const items = (prefix: string) => [1, 2, 3, 4, 5].map((i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}`, image: '' }));

function Rows({ titles }: { titles: string[] }) {
  return (
    <div>
      {titles.map((t) => (
        <div key={t} data-testid={`row-${t}`}>
          <VirtualDashboardRow title={t} items={items(t)} />
        </div>
      ))}
    </div>
  );
}

beforeEach(() => {
  observers.length = 0;
  document.documentElement.style.fontSize = '16px'; // jsdom ne calcule pas la taille de police
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const mounted = (title: string) => screen.getByTestId(`row-${title}`).querySelector('[data-testid="card"]') !== null;

describe('rangée des Suggestions (bureau, téléphone)', () => {
  it('rien avant la visibilité : ni titre ni cadres gris', () => {
    render(<Rows titles={['A']} />);
    expect(document.querySelector('.carousel-title')).toBeNull();
    expect(document.querySelectorAll('.carousel-placeholder-frame')).toHaveLength(0);
  });

  it('montée à l\'approche de l\'écran, retirée tout de suite à la sortie, sans minuteur', () => {
    vi.useFakeTimers();
    try {
      render(<Rows titles={['A', 'B', 'C']} />);
      intersect('B', true);
      expect(mounted('B')).toBe(true);
      expect(mounted('A')).toBe(false);
      intersect('B', false);
      expect(mounted('B')).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
