/**
 * Tests pour useInertiaScroll.ts
 * Vérifie : glisser à la souris, seuil de glissement, inertie, nettoyage.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useInertiaScroll } from '../useInertiaScroll';

function Harness() {
  const { ref, isDragging, dragStarted, handleMouseDown } = useInertiaScroll();
  return (
    <div>
      <div data-testid="piste" ref={ref} onMouseDown={handleMouseDown} />
      <span data-testid="etat">{`${isDragging}|${dragStarted}`}</span>
    </div>
  );
}

function move(x: number) {
  const e = new MouseEvent('mousemove', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pageX', { value: x });
  act(() => {
    document.dispatchEvent(e);
  });
}

function down(el: HTMLElement, x: number) {
  const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'pageX', { value: x });
  act(() => {
    el.dispatchEvent(e);
  });
}

function up() {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

describe('useInertiaScroll', () => {
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

  it('démarre au repos', () => {
    render(<Harness />);
    expect(screen.getByTestId('etat')).toHaveTextContent('false|false');
  });

  it('passe en glissement à l\'appui et en sort au relâchement', () => {
    render(<Harness />);
    down(screen.getByTestId('piste'), 100);
    expect(screen.getByTestId('etat')).toHaveTextContent('true|false');
    up();
    expect(screen.getByTestId('etat')).toHaveTextContent('false|false');
  });

  it('fait défiler la piste dans le sens inverse du geste', () => {
    render(<Harness />);
    const piste = screen.getByTestId('piste');
    piste.scrollLeft = 200;
    down(piste, 300);
    move(250);
    expect(piste.scrollLeft).toBe(250);
    up();
  });

  it('ne considère pas un petit mouvement comme un glissement', () => {
    render(<Harness />);
    down(screen.getByTestId('piste'), 100);
    move(105);
    expect(screen.getByTestId('etat')).toHaveTextContent('true|false');
    up();
  });

  it('signale un glissement au-delà de 10 pixels puis le garde un court instant après le relâchement', () => {
    render(<Harness />);
    down(screen.getByTestId('piste'), 100);
    move(130);
    expect(screen.getByTestId('etat')).toHaveTextContent('true|true');
    up();
    expect(screen.getByTestId('etat')).toHaveTextContent('false|true');
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(screen.getByTestId('etat')).toHaveTextContent('false|false');
  });

  it('continue de défiler par inertie après un geste rapide', () => {
    render(<Harness />);
    const piste = screen.getByTestId('piste');
    piste.scrollLeft = 500;
    down(piste, 300);
    move(280);
    vi.setSystemTime(1010);
    move(240);
    const apresGeste = piste.scrollLeft;
    up();
    expect(piste.scrollLeft).toBeGreaterThan(apresGeste);
    expect(rafCallbacks.length).toBeGreaterThan(0);
  });

  it('ne lance pas d\'inertie quand le geste est resté immobile avant le relâchement', () => {
    render(<Harness />);
    const piste = screen.getByTestId('piste');
    piste.scrollLeft = 500;
    down(piste, 300);
    move(250);
    vi.setSystemTime(1500);
    up();
    expect(rafCallbacks).toHaveLength(0);
  });

  it('arrête l\'inertie en cours quand on ré-appuie', () => {
    render(<Harness />);
    const piste = screen.getByTestId('piste');
    piste.scrollLeft = 500;
    down(piste, 300);
    move(280);
    vi.setSystemTime(1010);
    move(240);
    up();
    down(piste, 200);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    up();
  });

  it('retire ses écouteurs de document au démontage', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<Harness />);
    down(screen.getByTestId('piste'), 100);
    unmount();
    const types = remove.mock.calls.map((c) => c[0]);
    expect(types).toContain('mousemove');
    expect(types).toContain('mouseup');
    remove.mockRestore();
  });

  it('ignore un appui quand la piste n\'est pas affichée', () => {
    function Detached() {
      const { handleMouseDown, isDragging } = useInertiaScroll();
      return <button onMouseDown={handleMouseDown}>{String(isDragging)}</button>;
    }
    render(<Detached />);
    fireEvent.mouseDown(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('false');
  });
});
