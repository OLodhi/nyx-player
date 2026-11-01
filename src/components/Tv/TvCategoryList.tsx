/**
 * TvCategoryList — Catégories de chaînes au doigt : Favoris, Épinglées, puis toutes.
 *
 * Une seule zone qui défile : dans la liste rapide du lecteur, les épinglées avaient leur propre
 * zone et écrasaient le reste des catégories. Partagée par la page Live TV du téléphone (feuille
 * depuis le bas, avec recherche) et la liste rapide du lecteur (ChannelSwitcherCompact, sans
 * recherche : en paysage, le clavier couvrirait la liste).
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './TvCategoryList.css';

export interface TvCategory {
  category_id: string;
  category_name: string;
}

/** Identifiant de la pseudo-catégorie des favoris */
export const FAVORITES_CATEGORY_ID = 'favorites';

const PinIcon: React.FC = () => (
  <svg viewBox="0 0 125.76 191.46" fill="currentColor" aria-hidden="true">
    <path d="M54.28,127.32l-7.08-2.93-7.08-2.93c-.69-.29-1.5.05-1.78.74l-14.93,46.9-4.17,21.69c-.03.37.04.6.18.65.14.06.35-.05.59-.34l12.39-18.29,22.61-43.72c.29-.69-.05-1.5-.74-1.78Z" />
    <path d="M107,129.87c5.4-13.04,2.62-26.68-2.48-38.56-1.08-2.52-1.3-5.33-.56-7.98l10.27-42.89c.19-.69.95-1.09,1.61-.81,2.88,1.2,6.22-.18,7.41-3.06l2.08-5.03c1.19-2.88-.17-6.18-3.06-7.38L64.99.43c-2.88-1.19-6.18.17-7.38,3.06l-2.08,5.03c-1.19,2.88.19,6.21,3.07,7.4.67.27.92,1.09.57,1.72l-23.07,37.59c-1.35,2.39-3.49,4.23-6.04,5.24-12.01,4.8-23.71,12.69-29.02,25.51-.92,2.21-2.68,6.08,2.52,8.24,10.31,4.27,85.51,35.42,95.82,39.69,5.21,2.16,6.7-1.83,7.61-4.04Z" />
  </svg>
);

interface TvCategoryListProps {
  categories: TvCategory[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  pinnedCategoryIds: Set<string>;
  onTogglePin: (categoryId: string) => void;
  totalChannels: number;
  /** Recherche en cours : les catégories sont filtrées et les épinglées ne sont pas répétées */
  query?: string;
  onScroll?: React.UIEventHandler<HTMLUListElement>;
  className?: string;
}

const TvCategoryList: React.FC<TvCategoryListProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
  pinnedCategoryIds,
  onTogglePin,
  totalChannels,
  query = '',
  onScroll,
  className = '',
}) => {
  const { t } = useTranslation('tv');

  const pinned = useMemo(
    () => categories.filter((c) => pinnedCategoryIds.has(c.category_id)),
    [categories, pinnedCategoryIds],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter((c) => c.category_name.toLowerCase().includes(needle));
  }, [categories, query]);

  const renderRow = (category: TvCategory) => {
    const isPinned = pinnedCategoryIds.has(category.category_id);
    return (
      <li key={category.category_id} className="tv-cat-list__row">
        <button
          type="button"
          className={`tv-cat-list__item${selectedCategory === category.category_id ? ' active' : ''}`}
          data-testid="live-category"
          data-category-id={category.category_id}
          onClick={() => onSelectCategory(category.category_id)}
        >
          {category.category_name}
        </button>
        <button
          type="button"
          className={`tv-cat-list__pin${isPinned ? ' pinned' : ''}`}
          data-testid="live-category-pin"
          onClick={() => onTogglePin(category.category_id)}
          title={isPinned ? t('unpin') : t('pin')}
          aria-label={isPinned ? t('unpin') : t('pin')}
        >
          <PinIcon />
        </button>
      </li>
    );
  };

  return (
    <ul className={`tv-cat-list ${className}`.trim()} onScroll={onScroll}>
      <li className="tv-cat-list__row">
        <button
          type="button"
          className={`tv-cat-list__item${selectedCategory === FAVORITES_CATEGORY_ID ? ' active' : ''}`}
          data-testid="live-category-favorites"
          onClick={() => onSelectCategory(FAVORITES_CATEGORY_ID)}
        >
          {t('sidebar_favorites')}
        </button>
      </li>

      {!query && pinned.length > 0 && (
        <>
          <li className="tv-cat-list__label">{t('sidebar_pinned')}</li>
          {pinned.map(renderRow)}
        </>
      )}

      <li className="tv-cat-list__label">
        {t('sidebar_all')} <span className="tv-cat-list__count">{totalChannels}</span>
      </li>
      {filtered.map(renderRow)}
    </ul>
  );
};

export default TvCategoryList;
