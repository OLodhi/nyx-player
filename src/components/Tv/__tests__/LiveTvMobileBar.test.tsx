/**
 * Tests pour LiveTvMobileBar.tsx — barre Live TV du téléphone.
 * Vérifie : nom de la catégorie courante, feuille de choix, recherche, bouton Retour, modes Chaînes / Guide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import LiveTvMobileBar from '../LiveTvMobileBar';
import { FAVORITES_CATEGORY_ID } from '../TvCategoryList';
import { dispatchBack } from '../../../hooks/useBackHandler';

const categories = [
  { category_id: '1', category_name: 'FR | Sport' },
  { category_id: '2', category_name: 'FR | Info' },
];

function setup(overrides: Partial<React.ComponentProps<typeof LiveTvMobileBar>> = {}) {
  const props = {
    categories,
    selectedCategory: '1',
    onSelectCategory: vi.fn(),
    pinnedCategoryIds: new Set<string>(),
    onTogglePin: vi.fn(),
    totalChannels: 12,
    ...overrides,
  };
  render(<LiveTvMobileBar {...props} />);
  return props;
}

describe('LiveTvMobileBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Catégorie courante', () => {
    it('affiche le nom de la catégorie sélectionnée', () => {
      setup();
      expect(screen.getByTestId('live-category-picker')).toHaveTextContent('FR | Sport');
    });

    it('affiche « Favoris » pour la pseudo-catégorie des favoris', () => {
      setup({ selectedCategory: FAVORITES_CATEGORY_ID });
      expect(screen.getByTestId('live-category-picker')).toHaveTextContent('sidebar_favorites');
    });

    it('affiche « Toutes » quand la catégorie est inconnue', () => {
      setup({ selectedCategory: 'inconnue' });
      expect(screen.getByTestId('live-category-picker')).toHaveTextContent('sidebar_all');
    });
  });

  describe('Feuille de choix', () => {
    it('est fermée au départ et s\'ouvre au clic sur le bouton', () => {
      setup();
      expect(screen.queryByTestId('live-category-sheet')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      expect(screen.getByTestId('live-category-sheet')).toBeInTheDocument();
    });

    it('choisit une catégorie puis se referme', () => {
      const props = setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      fireEvent.click(within(screen.getByTestId('live-category-sheet')).getByText('FR | Info'));
      expect(props.onSelectCategory).toHaveBeenCalledWith('2');
      expect(screen.queryByTestId('live-category-sheet')).not.toBeInTheDocument();
    });

    it('filtre les catégories avec la recherche et la vide à la fermeture', () => {
      setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      fireEvent.change(screen.getByTestId('live-category-search'), { target: { value: 'info' } });
      const feuille = within(screen.getByTestId('live-category-sheet'));
      expect(feuille.queryByText('FR | Sport')).not.toBeInTheDocument();
      expect(feuille.getByText('FR | Info')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('live-category-sheet'));
      fireEvent.click(screen.getByTestId('live-category-picker'));
      expect(screen.getByTestId('live-category-search')).toHaveValue('');
    });

    it('se ferme en touchant en dehors du panneau mais pas dedans', () => {
      setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      fireEvent.click(screen.getByTestId('live-category-search'));
      expect(screen.getByTestId('live-category-sheet')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('live-category-sheet'));
      expect(screen.queryByTestId('live-category-sheet')).not.toBeInTheDocument();
    });

    it('se ferme avec le bouton Retour', () => {
      setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      act(() => {
        dispatchBack();
      });
      expect(screen.queryByTestId('live-category-sheet')).not.toBeInTheDocument();
    });

    it('referme le clavier avec Entrée dans la recherche', () => {
      setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      const champ = screen.getByTestId('live-category-search');
      champ.focus();
      expect(champ).toHaveFocus();
      fireEvent.keyDown(champ, { key: 'Enter' });
      expect(champ).not.toHaveFocus();
    });

    it('épingle une catégorie sans fermer la feuille', () => {
      const props = setup();
      fireEvent.click(screen.getByTestId('live-category-picker'));
      fireEvent.click(screen.getAllByTestId('live-category-pin')[0]);
      expect(props.onTogglePin).toHaveBeenCalledWith('1');
      expect(screen.getByTestId('live-category-sheet')).toBeInTheDocument();
    });
  });

  describe('Modes Chaînes / Guide', () => {
    it('masque les modes sans guide des programmes', () => {
      setup();
      expect(screen.queryByTestId('live-view-grid')).not.toBeInTheDocument();
      expect(screen.queryByTestId('live-view-epg')).not.toBeInTheDocument();
    });

    it('marque le mode actif et bascule au clic', () => {
      const onViewModeChange = vi.fn();
      setup({ viewMode: 'grid', onViewModeChange });
      expect(screen.getByTestId('live-view-grid')).toHaveClass('active');
      expect(screen.getByTestId('live-view-epg')).not.toHaveClass('active');
      fireEvent.click(screen.getByTestId('live-view-epg'));
      expect(onViewModeChange).toHaveBeenCalledWith('epg');
      fireEvent.click(screen.getByTestId('live-view-grid'));
      expect(onViewModeChange).toHaveBeenCalledWith('grid');
    });
  });
});
