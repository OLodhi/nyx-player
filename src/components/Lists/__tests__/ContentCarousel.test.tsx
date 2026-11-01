/**
 * Tests pour ContentCarousel.tsx
 * Vérifie : rangée vide, chargement, affichage des cartes, glissement à la souris et inertie.
 * Les cartes sont remplacées par un relevé : seul le comportement de la rangée est testé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../CarouselCard', () => ({
  CarouselCard: ({ item, dragStarted }: { item: { id: string | number; title: string; onClick?: () => void }; dragStarted: boolean }) => (
    <button type="button" data-testid="carte" data-drag={String(dragStarted)} onClick={() => item.onClick?.()}>
      {item.title}
    </button>
  ),
}));

import ContentCarousel, { type CarouselItem } from '../ContentCarousel';

const items: CarouselItem[] = [
  { id: 1, title: 'Premier', image: 'http://exemple.test/1.jpg' },
  { id: 2, title: 'Second', image: 'http://exemple.test/2.jpg' },
];

function mouse(type: 'mousedown' | 'mousemove' | 'mouseup', x: number, target: Element | Document) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pageX', { value: x });
  act(() => {
    target.dispatchEvent(e);
  });
}

describe('ContentCarousel', () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('Rendu', () => {
    it('affiche le titre et une carte par élément', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      expect(screen.getByTestId('carousel-row-title')).toHaveTextContent('Nouveautés');
      expect(screen.getAllByTestId('carte')).toHaveLength(2);
    });

    it('affiche l\'icône devant le titre', () => {
      render(<ContentCarousel title="Nouveautés" items={items} titleIcon={<span data-testid="icone" />} />);
      expect(screen.getByTestId('icone')).toBeInTheDocument();
    });

    it('n\'affiche rien quand la liste est vide et que rien ne charge', () => {
      render(<ContentCarousel title="Nouveautés" items={[]} />);
      expect(screen.queryByTestId('carousel-row')).not.toBeInTheDocument();
    });

    it('affiche six emplacements de chargement sans cartes', () => {
      const { container } = render(<ContentCarousel title="Nouveautés" items={[]} loading />);
      expect(container.querySelectorAll('.skeleton')).toHaveLength(6);
      expect(screen.queryByTestId('carte')).not.toBeInTheDocument();
    });
  });

  describe('Glissement', () => {
    it('fait défiler la rangée dans le sens inverse de la souris', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      const piste = screen.getByTestId('carousel-row-track');
      piste.scrollLeft = 300;
      mouse('mousedown', 200, piste);
      expect(piste).toHaveClass('grabbing');
      mouse('mousemove', 150, document);
      expect(piste.scrollLeft).toBe(350);
      mouse('mouseup', 150, document);
      expect(piste).not.toHaveClass('grabbing');
    });

    it('signale aux cartes un glissement en cours, puis le retire peu après le relâchement', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      const piste = screen.getByTestId('carousel-row-track');
      expect(screen.getAllByTestId('carte')[0]).toHaveAttribute('data-drag', 'false');
      mouse('mousedown', 200, piste);
      mouse('mousemove', 120, document);
      expect(screen.getAllByTestId('carte')[0]).toHaveAttribute('data-drag', 'true');
      mouse('mouseup', 120, document);
      expect(screen.getAllByTestId('carte')[0]).toHaveAttribute('data-drag', 'true');
      act(() => {
        vi.advanceTimersByTime(150);
      });
      expect(screen.getAllByTestId('carte')[0]).toHaveAttribute('data-drag', 'false');
    });

    it('ne signale pas de glissement après un simple appui sans mouvement', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      const piste = screen.getByTestId('carousel-row-track');
      mouse('mousedown', 200, piste);
      mouse('mouseup', 200, document);
      expect(screen.getAllByTestId('carte')[0]).toHaveAttribute('data-drag', 'false');
    });

    it('prolonge le défilement par inertie après un geste rapide', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      const piste = screen.getByTestId('carousel-row-track');
      piste.scrollLeft = 500;
      mouse('mousedown', 300, piste);
      vi.setSystemTime(1020);
      mouse('mousemove', 260, document);
      mouse('mouseup', 260, document);
      expect(rafCallbacks).toHaveLength(1);
      const avant = piste.scrollLeft;
      act(() => rafCallbacks[0](0));
      expect(piste.scrollLeft).toBeGreaterThan(avant);
    });

    it('ne glisse pas pendant le chargement', () => {
      render(<ContentCarousel title="Nouveautés" items={[]} loading />);
      const piste = screen.getByTestId('carousel-row-track');
      mouse('mousedown', 200, piste);
      expect(piste).not.toHaveClass('grabbing');
    });

    it('arrête l\'inertie en cours à un nouvel appui', () => {
      render(<ContentCarousel title="Nouveautés" items={items} />);
      const piste = screen.getByTestId('carousel-row-track');
      mouse('mousedown', 300, piste);
      vi.setSystemTime(1020);
      mouse('mousemove', 260, document);
      mouse('mouseup', 260, document);
      mouse('mousedown', 100, piste);
      expect(cancelAnimationFrame).toHaveBeenCalled();
      mouse('mouseup', 100, document);
    });

    it('retire ses écouteurs de document au démontage', () => {
      const remove = vi.spyOn(document, 'removeEventListener');
      const { unmount } = render(<ContentCarousel title="Nouveautés" items={items} />);
      mouse('mousedown', 200, screen.getByTestId('carousel-row-track'));
      unmount();
      const types = remove.mock.calls.map((c) => c[0]);
      expect(types).toContain('mousemove');
      expect(types).toContain('mouseup');
      remove.mockRestore();
    });
  });
});
