import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLayoutEffect, useRef } from 'react';
import { render } from '@testing-library/react';
import { trackScrollPosition, SCROLL_SAVE_DELAY_MS } from '../scrollPositionSaver';

/** Conteneur dont chaque lecture de `scrollTop` est comptée. */
function makeContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let top = 0;
  const reads = vi.fn();
  Object.defineProperty(el, 'scrollTop', {
    get: () => {
      reads();
      return top;
    },
    set: (v: number) => {
      top = v;
    },
  });
  return { el, reads, setTop: (v: number) => { top = v; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('trackScrollPosition', () => {
  it('ne lit pas scrollTop à chaque événement : une seule lecture quand le défilement s\'arrête', () => {
    const { el, reads, setTop } = makeContainer();
    const onSave = vi.fn();
    trackScrollPosition(el, onSave);
    for (let i = 1; i <= 20; i += 1) {
      setTop(i * 10);
      el.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(16);
    }
    expect(reads).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS * 2);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledExactlyOnceWith(200);
  });

  it('au démontage, enregistre le défilement en attente si le conteneur est encore dans la page', () => {
    const { el, setTop } = makeContainer();
    const onSave = vi.fn();
    const stop = trackScrollPosition(el, onSave);
    setTop(340);
    el.dispatchEvent(new Event('scroll'));
    stop();
    expect(onSave).toHaveBeenCalledExactlyOnceWith(340);
    vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS * 2);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('conteneur déjà retiré de la page : ne sauvegarde pas un 0 trompeur', () => {
    const { el, setTop } = makeContainer();
    const onSave = vi.fn();
    const stop = trackScrollPosition(el, onSave);
    setTop(340);
    el.dispatchEvent(new Event('scroll'));
    el.remove();
    stop();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('un défilement continu ne crée qu\'un minuteur à la fois et la lecture attend le vrai repos', () => {
    const { el, reads, setTop } = makeContainer();
    const onSave = vi.fn();
    trackScrollPosition(el, onSave);
    const spy = vi.spyOn(globalThis, 'setTimeout');
    for (let i = 1; i <= 30; i += 1) {
      setTop(i);
      el.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(30); // 900 ms de défilement continu
    }
    expect(reads).not.toHaveBeenCalled();
    // un minuteur par tranche de 120 ms au plus, pas un par événement
    expect(spy.mock.calls.length).toBeLessThan(15);
    vi.advanceTimersByTime(SCROLL_SAVE_DELAY_MS * 2);
    expect(onSave).toHaveBeenCalledExactlyOnceWith(30);
    spy.mockRestore();
  });

  it('sans défilement en attente, le démontage ne lit rien', () => {
    const { el, reads } = makeContainer();
    const stop = trackScrollPosition(el, vi.fn());
    stop();
    expect(reads).not.toHaveBeenCalled();
  });
});

describe('trackScrollPosition dans un composant (démontage et changement de mode)', () => {
  function Page({ mode, onSave, onContainer }: { mode: string; onSave: (mode: string, top: number) => void; onContainer: (el: HTMLDivElement) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    // Même ordre que l'accueil : restauration du mode, puis suivi de la position
    useLayoutEffect(() => {
      if (ref.current) {
        onContainer(ref.current);
        ref.current.scrollTop = mode === 'a' ? 100 : 900;
      }
    }, [mode, onContainer]);
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return undefined;
      return trackScrollPosition(el, (top) => onSave(mode, top));
    }, [mode, onSave]);
    return <div ref={ref} />;
  }

  it('au démontage de la page (appui sur OK juste après un défilement), la dernière position est enregistrée', () => {
    const onSave = vi.fn();
    let container!: HTMLDivElement;
    const { unmount } = render(<Page mode="a" onSave={onSave} onContainer={(el) => { container = el; }} />);
    container.scrollTop = 260;
    container.dispatchEvent(new Event('scroll'));
    unmount();
    expect(onSave).toHaveBeenCalledExactlyOnceWith('a', 260);
  });

  it('changement de mode pendant un défilement : la position est rangée sous l\'ancien mode, pas sous le nouveau', () => {
    const onSave = vi.fn();
    let container!: HTMLDivElement;
    const grab = (el: HTMLDivElement) => { container = el; };
    const { rerender } = render(<Page mode="a" onSave={onSave} onContainer={grab} />);
    container.scrollTop = 260;
    container.dispatchEvent(new Event('scroll'));
    rerender(<Page mode="b" onSave={onSave} onContainer={grab} />);
    expect(onSave).toHaveBeenCalledExactlyOnceWith('a', 260);
  });
});
