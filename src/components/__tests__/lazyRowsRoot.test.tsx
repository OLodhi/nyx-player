/**
 * Rangées paresseuses : l'observateur prend le conteneur qui défile pour racine, sinon la marge
 * d'anticipation est rognée et la rangée suivante n'existe pas encore quand on appuie sur Bas.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import LazyCategory from '../Iptv/LazyCategory';
import VirtualDashboardRow from '../Dashboard/VirtualDashboardRow';

const roots: Array<Element | Document | null | undefined> = [];

class FakeObserver {
  constructor(_cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    roots.push(options?.root);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() { return []; }
}

afterEach(() => { roots.length = 0; vi.unstubAllGlobals(); });

function dansUnConteneur(ui: React.ReactElement) {
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  document.body.appendChild(scroller);
  render(ui, { container: scroller.appendChild(document.createElement('div')) });
  return scroller;
}

describe('racine des rangées paresseuses', () => {
  it('LazyCategory observe dans le conteneur qui défile', () => {
    const scroller = dansUnConteneur(<LazyCategory><span>x</span></LazyCategory>);
    expect(roots).toEqual([scroller]);
  });

  it('VirtualDashboardRow observe dans le conteneur qui défile', () => {
    const scroller = dansUnConteneur(
      <VirtualDashboardRow title="t" items={[{ id: '1', title: 'a', posterUrl: '' } as never]} />,
    );
    expect(roots).toEqual([scroller]);
  });
});
