/**
 * Fenêtre « Gérer les catégories » à la télécommande (banc de test) : la fenêtre
 * n'était pas un calque « modal », la navigation spatiale gardait donc la page des Paramètres derrière
 * dans ses candidats. Depuis que la page est correctement centrée, le bouton « Gérer les
 * catégories » de la page tombe juste sous les boutons de la fenêtre : la flèche bas y partait, et la
 * première catégorie n'était jamais atteinte. Comme ConfirmModal : la sélection reste dans la fenêtre.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import CategoryManagerModal from '../CategoryManagerModal';
import { candidates } from '../../../utils/spatialNavigation/dom';
import type { LightIndexes } from '../../../types/lightIndex';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));
vi.mock('../../../services/hiddenCategoriesService', () => ({
  getHiddenSet: () => new Set<string>(),
  setAllHidden: vi.fn(),
}));

const lightIndexes = {
  movies: new Map(),
  series: new Map(),
  live: new Map(),
  categories: new Map([['1', { id: '1', name: 'Action', type: 'movie' }]]),
} as unknown as LightIndexes;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('CategoryManagerModal — télécommande', () => {
  it('ne propose pas les boutons de la page derrière la fenêtre', () => {
    // jsdom ne calcule pas de mise en page : chaque élément reçoit une boîte visible
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON: () => ({}) } as DOMRect,
    );
    const behind = document.createElement('button');
    behind.textContent = 'settings-manage-categories';
    document.body.appendChild(behind);

    const { getByTestId, getAllByTestId } = render(
      <CategoryManagerModal isOpen onClose={() => {}} lightIndexes={lightIndexes} />,
    );
    const pool = candidates(getAllByTestId('category-manager-tab')[0]);

    expect(pool).not.toContain(behind);
    expect(pool).toContain(getAllByTestId('category-manager-item')[0]);
    expect(getByTestId('category-manager').getAttribute('data-nav-layer')).toBe('modal');
  });
});
