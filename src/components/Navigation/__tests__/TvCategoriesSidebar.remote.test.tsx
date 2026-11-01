/**
 * Épingle des catégories Live TV à la télécommande : l'épingle, simple élément dans le bouton
 * de la catégorie, n'est pas un arrêt du parcours ; épingler était impossible sur TV.
 * Règle des cartes à la télécommande : l'appui long sur OK fait l'action
 * secondaire, ici épingler / retirer l'épingle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import TvCategoriesSidebar from '../TvCategoriesSidebar';
import { installSpatialNavigation } from '../../../utils/spatialNavigation';
import { LONG_PRESS_MS } from '../../../utils/spatialNavigation/okKey';
import { setTvMode } from '../../../utils/platform';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const categories = [
  { category_id: 'c1', category_name: 'Sport' },
  { category_id: 'c2', category_name: 'Cinéma' },
  { category_id: 'c3', category_name: 'Infos' },
];

function renderSidebar(pinned: string[] = []) {
  const onTogglePin = vi.fn();
  const onSelectCategory = vi.fn();
  const view = render(
    <TvCategoriesSidebar
      categories={categories}
      selectedCategory="c1"
      onSelectCategory={onSelectCategory}
      pinnedCategoryIds={new Set(pinned)}
      onTogglePin={onTogglePin}
      totalChannels={10}
    />,
  );
  return { ...view, onTogglePin, onSelectCategory };
}

const key = (type: 'keydown' | 'keyup', repeat = false) => {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent(type, { key: 'Enter', bubbles: true, cancelable: true, repeat }),
    );
  });
};

/** OK maintenu au-delà de l'appui long, la télécommande répète la touche, puis relâché */
const longOk = () => {
  key('keydown');
  key('keydown', true);
  act(() => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
  key('keydown', true);
  key('keyup');
};

const allButton = (id: string) =>
  within(screen.getByTestId('live-categories')).getAllByTestId('live-category').find((b) => b.dataset.categoryId === id)!;

let uninstall: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  setTvMode(true);
  uninstall = installSpatialNavigation();
});

afterEach(() => {
  uninstall();
  setTvMode(false);
  vi.useRealTimers();
});

describe('TvCategoriesSidebar à la télécommande', () => {
  it('appui long sur OK : épingle la catégorie, une seule fois, sans la choisir', () => {
    const { onTogglePin, onSelectCategory } = renderSidebar();
    act(() => allButton('c2').focus());
    longOk();
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(onTogglePin).toHaveBeenCalledWith('c2');
    expect(onSelectCategory).not.toHaveBeenCalled();
  });

  // L'appui long prend la touche OK : l'appui court doit toujours choisir la catégorie
  it('OK court : choisit la catégorie, sans toucher à l\'épingle', () => {
    const { onTogglePin, onSelectCategory } = renderSidebar();
    act(() => allButton('c3').focus());
    key('keydown');
    key('keyup');
    expect(onSelectCategory).toHaveBeenCalledWith('c3');
    expect(onTogglePin).not.toHaveBeenCalled();
  });

  it('section « Épinglées » : l\'appui long retire l\'épingle et le focus passe à la voisine', () => {
    const { onTogglePin } = renderSidebar(['c1', 'c2']);
    const pinned = screen.getAllByTestId('live-category-pinned');
    act(() => pinned[0].focus());
    longOk();
    expect(onTogglePin).toHaveBeenCalledWith('c1');
    expect(document.activeElement).toBe(pinned[1]);
  });

  it('hors TV (bureau, Windows) : pas d\'appui long sur les catégories', () => {
    setTvMode(false);
    renderSidebar(['c1']);
    const buttons = [...screen.getAllByTestId('live-category'), ...screen.getAllByTestId('live-category-pinned')];
    expect(buttons.some((b) => b.hasAttribute('data-nav-longpress'))).toBe(false);
  });

  it('l\'épingle n\'est jamais un arrêt du parcours', () => {
    renderSidebar(['c1']);
    for (const pin of screen.getAllByTestId('live-category-pin')) {
      expect(pin.tagName).toBe('SPAN');
      expect(pin.hasAttribute('tabindex')).toBe(false);
    }
  });
});
