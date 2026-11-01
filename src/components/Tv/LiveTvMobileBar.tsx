/**
 * LiveTvMobileBar — Barre Live TV du téléphone : catégorie courante + mode d'affichage.
 *
 * Remplace `TvCategoriesSidebar` sur mobile : le bandeau de catégories qui défilait
 * horizontalement était difficile à viser au doigt, et masquait le choix Chaînes / Guide.
 * Le bouton ouvre la liste complète depuis le bas (TvCategoryList, avec recherche).
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { LiveTvViewMode } from '../../types/navigation';
import { useBackHandler } from '../../hooks/useBackHandler';
import { dismissKeyboardOnScroll } from '../../utils/keyboard';
import TvCategoryList, { FAVORITES_CATEGORY_ID, type TvCategory } from './TvCategoryList';
import './LiveTvMobileBar.css';

interface LiveTvMobileBarProps {
  categories: TvCategory[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  pinnedCategoryIds: Set<string>;
  onTogglePin: (categoryId: string) => void;
  totalChannels: number;
  /** Fourni seulement quand l'EPG est activé */
  viewMode?: LiveTvViewMode;
  onViewModeChange?: (mode: LiveTvViewMode) => void;
}

const LiveTvMobileBar: React.FC<LiveTvMobileBarProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  pinnedCategoryIds,
  onTogglePin,
  totalChannels,
  viewMode,
  onViewModeChange,
}) => {
  const { t } = useTranslation('tv');
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  useBackHandler(isOpen, () => setIsOpen(false));

  const currentName = useMemo(() => {
    if (selectedCategory === FAVORITES_CATEGORY_ID) return t('sidebar_favorites');
    return categories.find((c) => c.category_id === selectedCategory)?.category_name ?? t('sidebar_all');
  }, [selectedCategory, categories, t]);

  const close = () => {
    setIsOpen(false);
    setQuery('');
  };

  const select = (categoryId: string) => {
    onSelectCategory(categoryId);
    close();
  };

  return (
    <>
      <div className="live-tv-bar">
        <button type="button" className="live-tv-bar__picker" onClick={() => setIsOpen(true)} data-testid="live-category-picker">
          <span className="live-tv-bar__picker-name">{currentName}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {viewMode !== undefined && onViewModeChange && (
          <div className="live-tv-bar__modes">
            <button
              type="button"
              className={`live-tv-bar__mode${viewMode === 'grid' ? ' active' : ''}`}
              data-testid="live-view-grid"
              onClick={() => onViewModeChange('grid')}
            >
              {t('sidebar_title')}
            </button>
            <button
              type="button"
              className={`live-tv-bar__mode${viewMode === 'epg' ? ' active' : ''}`}
              data-testid="live-view-epg"
              onClick={() => onViewModeChange('epg')}
            >
              {t('sidebar_guide')}
            </button>
          </div>
        )}
      </div>

      {isOpen &&
        createPortal(
          <div className="tv-cat-sheet" data-testid="live-category-sheet" role="dialog" aria-modal="true" aria-label={t('sidebar_title')} onClick={close}>
            <div className="tv-cat-sheet__panel" onClick={(e) => e.stopPropagation()}>
              <div className="tv-cat-sheet__grip" />

              <input
                type="search"
                className="tv-cat-sheet__search"
                data-testid="live-category-search"
                placeholder={t('category_search_placeholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                enterKeyHint="search"
                autoComplete="off"
              />

              <TvCategoryList
                categories={categories}
                selectedCategory={selectedCategory}
                onSelectCategory={select}
                pinnedCategoryIds={pinnedCategoryIds}
                onTogglePin={onTogglePin}
                totalChannels={totalChannels}
                query={query}
                onScroll={dismissKeyboardOnScroll}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default LiveTvMobileBar;
