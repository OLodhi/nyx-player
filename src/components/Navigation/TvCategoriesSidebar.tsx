/**
 * TvCategoriesSidebar - Extension de la sidebar pour les catégories TV
 * 
 * Apparaît à droite de la sidebar principale quand on est sur l'onglet TV.
 * Même style glass pour créer une fusion visuelle.
 *
 * Télécommande (Android TV) : chaque catégorie est un seul arrêt du parcours. OK la choisit, l'appui
 * long sur OK l'épingle ou retire son épingle (règle des cartes à la télécommande) :
 * l'épingle, simple élément dans le bouton, n'est jamais focusable (constaté au banc de test).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { LiveTvViewMode } from '../../types/navigation';
import { useTranslation } from 'react-i18next';
import { isTv } from '../../utils/platform';
import './TvCategoriesSidebar.css';

// ... TYPES ...
interface TvCategory {
    category_id: string;
    category_name: string;
}

interface TvCategoriesSidebarProps {
    categories: TvCategory[];
    selectedCategory: string;
    onSelectCategory: (categoryId: string) => void;
    pinnedCategoryIds: Set<string>;
    onTogglePin: (categoryId: string) => void;
    totalChannels: number;
    /** Mode d'affichage Live TV — optionnel, fourni seulement quand EPG est activé */
    viewMode?: LiveTvViewMode;
    /** Callback de changement de mode — optionnel, fourni seulement quand EPG est activé */
    onViewModeChange?: (mode: LiveTvViewMode) => void;
}

// ... CONSTANTS ...
const FAVORITES_ID = 'favorites';

/**
 * Sur TV, avant de retirer un bouton focusé de la section « Épinglées », le focus passe à son voisin
 * (le suivant, sinon le précédent, sinon Favoris) : sinon il tombait hors de la page.
 */
function focusNeighbour(button: HTMLElement, aside: HTMLElement): void {
    const next = button.nextElementSibling ?? button.previousElementSibling
        ?? aside.querySelector('.tv-categories-sidebar__fixed > .tv-category-item');
    if (next instanceof HTMLElement) next.focus({ preventScroll: true });
}

// ... COMPONENT ...
const TvCategoriesSidebar: React.FC<TvCategoriesSidebarProps> = ({
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
    const asideRef = useRef<HTMLElement>(null);
    // TV : l'appui long sur OK (`data-nav-longpress`, utils/spatialNavigation/) épingle la catégorie
    const tv = isTv();
    const longPress = tv ? '' : undefined;
    const togglePinRef = useRef(onTogglePin);
    useEffect(() => {
        togglePinRef.current = onTogglePin;
    });

    useEffect(() => {
        const aside = asideRef.current;
        if (!tv || !aside) return;
        // `nyx:longpress` ne remonte pas : écouté en capture, pour toutes les catégories à la fois
        const onLongPress = (event: Event) => {
            const button = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-category-id]') : null;
            const categoryId = button?.dataset.categoryId;
            if (!button || !categoryId) return;
            // Section « Épinglées » : retirer l'épingle retire aussi le bouton, qui a le focus
            if (button.closest('.tv-categories-sidebar__pinned-list') && document.activeElement === button) {
                focusNeighbour(button, aside);
            }
            togglePinRef.current(categoryId);
        };
        aside.addEventListener('nyx:longpress', onLongPress, true);
        return () => aside.removeEventListener('nyx:longpress', onLongPress, true);
    }, [tv]);

    // Catégories épinglées (filtrées et triées)
    const pinnedCategories = useMemo(() => {
        return categories.filter((cat) => pinnedCategoryIds.has(cat.category_id));
    }, [categories, pinnedCategoryIds]);

    return (
        <aside ref={asideRef} className="tv-categories-sidebar" data-nav-zone="aside" data-testid="live-categories">
            {/* Header */}
            <div className="tv-categories-sidebar__header">
                {viewMode !== undefined && onViewModeChange ? (
                    <div className="tv-categories-sidebar__switch">
                        <button
                            className={`tv-categories-sidebar__switch-btn${viewMode === 'grid' ? ' active' : ''}`}
                            data-testid="live-view-grid"
                            onClick={() => onViewModeChange('grid')}
                        >{t('sidebar_title')}</button>
                        <button
                            className={`tv-categories-sidebar__switch-btn${viewMode === 'epg' ? ' active' : ''}`}
                            data-testid="live-view-epg"
                            onClick={() => onViewModeChange('epg')}
                        >{t('sidebar_guide')}</button>
                    </div>
                ) : (
                    <>
                        <h2 className="tv-categories-sidebar__title">{t('sidebar_title')}</h2>
                        <span className="tv-categories-sidebar__count">{totalChannels}</span>
                    </>
                )}
            </div>

            {/* Zone Fixe : Favoris + Épinglées */}
            <div className="tv-categories-sidebar__fixed">
                {/* 1. Favoris */}
                <button
                    className={`tv-category-item ${selectedCategory === FAVORITES_ID ? 'active' : ''}`}
                    data-testid="live-category-favorites"
                    onClick={() => onSelectCategory(FAVORITES_ID)}
                >
                    <span className="tv-category-item__icon"><svg viewBox="0 0 192.6 172.24" fill="currentColor" style={{ width: '1rem', height: '1rem' }}><path d="M143.2,0c-13.34,0-25.84,5.53-35.21,15.57l-4.54,4.86s-3.58,3.84-7.16,7.67l-7.16-7.67-4.54-4.86C75.24,5.53,62.73,0,49.39,0S23.55,5.53,14.18,15.57c-18.91,20.27-18.91,53.26,0,73.54l74.96,75.89,7.16,7.24c3.58-3.62,7.16-7.24,7.16-7.24l74.96-75.89c18.91-20.28,18.91-53.27,0-73.54-9.37-10.04-21.87-15.57-35.21-15.57h0Z"/></svg></span>
                    <span className="tv-category-item__name">{t('sidebar_favorites')}</span>
                </button>

                {/* 2. Épinglées */}
                {pinnedCategories.length > 0 && (
                    <>
                        <div className="tv-categories-sidebar__section-label">{t('sidebar_pinned')}</div>
                        <div className="tv-categories-sidebar__pinned-list scrollbar-thin">
                            {pinnedCategories.map((cat) => (
                                <button
                                    key={`pinned-${cat.category_id}`}
                                    className={`tv-category-item ${selectedCategory === cat.category_id ? 'active' : ''}`}
                                    data-testid="live-category-pinned"
                                    data-category-id={cat.category_id}
                                    data-nav-longpress={longPress}
                                    onClick={() => onSelectCategory(cat.category_id)}
                                >
                                    <span className="tv-category-item__name">{cat.category_name}</span>
                                    <span
                                        className="tv-category-item__pin-btn pinned"
                                        data-testid="live-category-pin"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onTogglePin(cat.category_id);
                                        }}
                                        title={t('unpin')}
                                    >
                                        <svg viewBox="0 0 125.76 191.46" fill="currentColor" style={{ width: '1.125rem', height: '1.125rem' }}><path d="M54.28,127.32l-7.08-2.93-7.08-2.93c-.69-.29-1.5.05-1.78.74l-14.93,46.9-4.17,21.69c-.03.37.04.6.18.65.14.06.35-.05.59-.34l12.39-18.29,22.61-43.72c.29-.69-.05-1.5-.74-1.78Z"/><path d="M107,129.87c5.4-13.04,2.62-26.68-2.48-38.56-1.08-2.52-1.3-5.33-.56-7.98l10.27-42.89c.19-.69.95-1.09,1.61-.81,2.88,1.2,6.22-.18,7.41-3.06l2.08-5.03c1.19-2.88-.17-6.18-3.06-7.38L64.99.43c-2.88-1.19-6.18.17-7.38,3.06l-2.08,5.03c-1.19,2.88.19,6.21,3.07,7.4.67.27.92,1.09.57,1.72l-23.07,37.59c-1.35,2.39-3.49,4.23-6.04,5.24-12.01,4.8-23.71,12.69-29.02,25.51-.92,2.21-2.68,6.08,2.52,8.24,10.31,4.27,85.51,35.42,95.82,39.69,5.21,2.16,6.7-1.83,7.61-4.04Z"/></svg>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {/* Séparateur */}
                <div className="tv-categories-sidebar__divider" />
            </div>

            {/* Zone Scrollable : Toutes les catégories */}
            <div className="tv-categories-sidebar__scrollable scrollbar-thin">
                <div className="tv-categories-sidebar__section-label">{t('sidebar_all')}</div>
                {categories.map((cat) => {
                    const isPinned = pinnedCategoryIds.has(cat.category_id);
                    return (
                        <button
                            key={cat.category_id}
                            className={`tv-category-item ${selectedCategory === cat.category_id ? 'active' : ''}`}
                            data-testid="live-category"
                            data-category-id={cat.category_id}
                            data-nav-longpress={longPress}
                            onClick={() => onSelectCategory(cat.category_id)}
                        >
                            <span className="tv-category-item__name">{cat.category_name}</span>
                            <span
                                className={`tv-category-item__pin-btn ${isPinned ? 'pinned' : ''}`}
                                data-testid="live-category-pin"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(cat.category_id);
                                }}
                                title={isPinned ? t('unpin') : t('pin')}
                            >
                                <svg viewBox="0 0 125.76 191.46" fill="currentColor" style={{ width: '1.125rem', height: '1.125rem' }}><path d="M54.28,127.32l-7.08-2.93-7.08-2.93c-.69-.29-1.5.05-1.78.74l-14.93,46.9-4.17,21.69c-.03.37.04.6.18.65.14.06.35-.05.59-.34l12.39-18.29,22.61-43.72c.29-.69-.05-1.5-.74-1.78Z"/><path d="M107,129.87c5.4-13.04,2.62-26.68-2.48-38.56-1.08-2.52-1.3-5.33-.56-7.98l10.27-42.89c.19-.69.95-1.09,1.61-.81,2.88,1.2,6.22-.18,7.41-3.06l2.08-5.03c1.19-2.88-.17-6.18-3.06-7.38L64.99.43c-2.88-1.19-6.18.17-7.38,3.06l-2.08,5.03c-1.19,2.88.19,6.21,3.07,7.4.67.27.92,1.09.57,1.72l-23.07,37.59c-1.35,2.39-3.49,4.23-6.04,5.24-12.01,4.8-23.71,12.69-29.02,25.51-.92,2.21-2.68,6.08,2.52,8.24,10.31,4.27,85.51,35.42,95.82,39.69,5.21,2.16,6.7-1.83,7.61-4.04Z"/></svg>
                            </span>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
};

export default TvCategoriesSidebar;
