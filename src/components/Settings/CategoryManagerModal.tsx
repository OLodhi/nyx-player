/**
 * CategoryManagerModal — Modal de gestion des catégories masquées
 *
 * UX "Valider" : les coches modifient un draft local (Set),
 * le commit vers SQLite/cloud ne se fait qu'au clic "Valider".
 *
 * Pattern identique à ConfirmModal : backdrop + Escape + click-outside.
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { LightIndexes, LightCategory } from '../../types/lightIndex';
import { useBackHandler } from '../../hooks/useBackHandler';
import { getHiddenSet, setAllHidden } from '../../services/hiddenCategoriesService';
import { devLog } from '../../utils/devLog';
import NyxButton from '../Common/NyxButton';
import filmIcon from '../../assets/icons/film.svg';
import screenIcon from '../../assets/icons/screen.svg';
import './CategoryManagerModal.css';

// ============================================================================
// TYPES
// ============================================================================
type CategoryType = 'movie' | 'series' | 'live';

interface TabConfig {
    type: CategoryType;
    labelKey: string;
    icon: string;
}

const TABS: TabConfig[] = [
    { type: 'movie', labelKey: 'tab_movies', icon: 'film' },
    { type: 'series', labelKey: 'tab_series', icon: 'series-emoji' },
    { type: 'live', labelKey: 'tab_live', icon: 'screen' },
];

interface CategoryManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    lightIndexes: LightIndexes;
}

// ============================================================================
// COMPONENT
// ============================================================================
const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({
    isOpen,
    onClose,
    lightIndexes,
}) => {
    const { t } = useTranslation('settings');
    const [activeTab, setActiveTab] = useState<CategoryType>('movie');
    const [searchTerm, setSearchTerm] = useState('');
    const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
    const [isSaving, setIsSaving] = useState(false);

    // =========================================================================
    // INIT DRAFT — Reset chaque fois que le modal s'ouvre
    // =========================================================================
    useEffect(() => {
        if (isOpen) {
            // Merge les 3 types en un seul Set de clés "id::type"
            const combined = new Set<string>();
            for (const tab of TABS) {
                const hiddenForType = getHiddenSet(tab.type);
                for (const catId of hiddenForType) {
                    combined.add(`${catId}::${tab.type}`);
                }
            }
            // eslint-disable-next-line react-hooks/set-state-in-effect -- brouillon relu à chaque ouverture depuis les catégories masquées enregistrées
            setDraftHidden(combined);
            setSearchTerm('');
            setActiveTab('movie');
        }
    }, [isOpen]);

    useBackHandler(isOpen, onClose);

    // =========================================================================
    // KEYBOARD — Escape ferme le modal (hook avant conditional return)
    // =========================================================================
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // =========================================================================
    // CATEGORIES PAR TYPE (memoized)
    // =========================================================================
    const categoriesByType = useMemo(() => {
        const map: Record<CategoryType, LightCategory[]> = {
            movie: [],
            series: [],
            live: [],
        };
        lightIndexes.categories.forEach((cat) => {
            if (map[cat.type]) {
                map[cat.type].push(cat);
            }
        });
        // Ordre préservé du provider (sort_order ASC depuis SQLite)
        return map;
    }, [lightIndexes.categories]);

    // =========================================================================
    // ITEM COUNTS PAR CATÉGORIE (memoized)
    // =========================================================================
    const itemCountsByCategory = useMemo(() => {
        const counts = new Map<string, number>();

        // Movies
        lightIndexes.movies.forEach((item) => {
            counts.set(`${item.categoryId}::movie`, (counts.get(`${item.categoryId}::movie`) || 0) + 1);
        });
        // Series
        lightIndexes.series.forEach((item) => {
            counts.set(`${item.categoryId}::series`, (counts.get(`${item.categoryId}::series`) || 0) + 1);
        });
        // Live
        lightIndexes.live.forEach((item) => {
            counts.set(`${item.categoryId}::live`, (counts.get(`${item.categoryId}::live`) || 0) + 1);
        });

        return counts;
    }, [lightIndexes.movies, lightIndexes.series, lightIndexes.live]);

    // =========================================================================
    // FILTERED CATEGORIES (recherche textuelle)
    // =========================================================================
    const filteredCategories = useMemo(() => {
        const cats = categoriesByType[activeTab];
        if (!searchTerm.trim()) return cats;
        const needle = searchTerm.toLowerCase().trim();
        return cats.filter((cat) => cat.name.toLowerCase().includes(needle));
    }, [categoriesByType, activeTab, searchTerm]);

    // =========================================================================
    // DRAFT HELPERS
    // =========================================================================
    const isDraftHidden = useCallback(
        (catId: string, type: CategoryType): boolean => {
            return draftHidden.has(`${catId}::${type}`);
        },
        [draftHidden]
    );

    const toggleDraft = useCallback(
        (catId: string, type: CategoryType) => {
            setDraftHidden((prev) => {
                const next = new Set(prev);
                const key = `${catId}::${type}`;
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
                return next;
            });
        },
        []
    );

    // =========================================================================
    // BATCH ACTIONS (sur le tab actif uniquement)
    // =========================================================================
    const handleHideAll = useCallback(() => {
        setDraftHidden((prev) => {
            const next = new Set(prev);
            for (const cat of categoriesByType[activeTab]) {
                next.add(`${cat.id}::${activeTab}`);
            }
            return next;
        });
    }, [categoriesByType, activeTab]);

    const handleShowAll = useCallback(() => {
        setDraftHidden((prev) => {
            const next = new Set(prev);
            for (const cat of categoriesByType[activeTab]) {
                next.delete(`${cat.id}::${activeTab}`);
            }
            return next;
        });
    }, [categoriesByType, activeTab]);

    const handleInvert = useCallback(() => {
        setDraftHidden((prev) => {
            const next = new Set(prev);
            for (const cat of categoriesByType[activeTab]) {
                const key = `${cat.id}::${activeTab}`;
                if (next.has(key)) {
                    next.delete(key);
                } else {
                    next.add(key);
                }
            }
            return next;
        });
    }, [categoriesByType, activeTab]);

    // =========================================================================
    // COUNTS pour badges tabs
    // =========================================================================
    const getHiddenCountForType = useCallback(
        (type: CategoryType): number => {
            let count = 0;
            for (const cat of categoriesByType[type]) {
                if (draftHidden.has(`${cat.id}::${type}`)) count++;
            }
            return count;
        },
        [categoriesByType, draftHidden]
    );

    // =========================================================================
    // VALIDATE — Commit vers service + fermer
    // =========================================================================
    const handleValidate = useCallback(async () => {
        setIsSaving(true);
        try {
            for (const tab of TABS) {
                const hiddenIdsForType: string[] = [];
                for (const cat of categoriesByType[tab.type]) {
                    if (draftHidden.has(`${cat.id}::${tab.type}`)) {
                        hiddenIdsForType.push(cat.id);
                    }
                }
                await setAllHidden(tab.type, hiddenIdsForType);
            }
            onClose();
        } catch (error) {
            devLog('data', '[CategoryManager] Validate failed:', error);
        } finally {
            setIsSaving(false);
        }
    }, [categoriesByType, draftHidden, onClose]);

    // =========================================================================
    // CONDITIONAL RETURN (après tous les hooks)
    // =========================================================================
    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    };

    const totalForTab = categoriesByType[activeTab].length;
    const hiddenForTab = getHiddenCountForType(activeTab);

    // =========================================================================
    // RENDER
    // =========================================================================
    return (
        <div className="confirm-modal-backdrop" data-testid="category-manager" onClick={handleBackdropClick} data-nav-layer="modal">
            <div className="category-manager-modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="catmgr-header">
                    <h3 className="catmgr-title">
                        <span className="catmgr-icon">📂</span>
                        {t('category_manager_title')}
                    </h3>
                    <button className="catmgr-close" data-testid="category-manager-close" onClick={onClose} aria-label={t('close')}>✕</button>
                </div>

                {/* Tabs */}
                <div className="catmgr-tabs">
                    {TABS.map((tab) => {
                        const hidden = getHiddenCountForType(tab.type);
                        const total = categoriesByType[tab.type].length;
                        return (
                            <button
                                key={tab.type}
                                className={`catmgr-tab ${activeTab === tab.type ? 'active' : ''}`}
                                data-testid="category-manager-tab"
                                data-type={tab.type}
                                onClick={() => { setActiveTab(tab.type); setSearchTerm(''); }}
                            >
                                <span className="catmgr-tab-icon">
                                    {tab.icon === 'film' ? (
                                        <img src={filmIcon} alt="Film" className="catmgr-tab-svg" />
                                    ) : tab.icon === 'screen' ? (
                                        <img src={screenIcon} alt="Live" className="catmgr-tab-svg" />
                                    ) : (
                                        <span>&#x1F4FA;</span>
                                    )}
                                </span>
                                {t(tab.labelKey as 'tab_movies')}
                                {hidden > 0 && (
                                    <span className="catmgr-tab-badge">{hidden}/{total}</span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Search */}
                <div className="catmgr-search">
                    <input
                        type="text"
                        className="catmgr-search-input"
                        data-testid="category-manager-search"
                        placeholder={t('search_categories')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        autoFocus
                    />
                    {searchTerm && (
                        <button className="catmgr-search-clear" data-testid="category-manager-search-clear" onClick={() => setSearchTerm('')}>✕</button>
                    )}
                </div>

                {/* Batch Actions */}
                <div className="catmgr-batch">
                    <NyxButton variant="primary" size="xs" color="blue" onClick={handleHideAll} data-testid="category-manager-hide-all">
                        {t('batch_hide_all')}
                    </NyxButton>
                    <NyxButton variant="primary" size="xs" color="blue" onClick={handleShowAll} data-testid="category-manager-show-all">
                        {t('batch_show_all')}
                    </NyxButton>
                    <NyxButton variant="primary" size="xs" color="blue" onClick={handleInvert} data-testid="category-manager-invert">
                        {t('batch_invert')}
                    </NyxButton>
                </div>

                {/* Category List */}
                <div className="catmgr-list scrollbar-thin">
                    {filteredCategories.length === 0 ? (
                        <p className="catmgr-empty">{t('no_categories')}</p>
                    ) : (
                        filteredCategories.map((cat) => {
                            const isHid = isDraftHidden(cat.id, activeTab);
                            const count = itemCountsByCategory.get(`${cat.id}::${activeTab}`) || 0;
                            return (
                                <label
                                    key={cat.id}
                                    className={`catmgr-item ${isHid ? 'hidden-category' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={!isHid}
                                        data-testid="category-manager-item"
                                        data-category-id={cat.id}
                                        onChange={() => toggleDraft(cat.id, activeTab)}
                                    />
                                    <span className="catmgr-item-name">{cat.name}</span>
                                    <span className="catmgr-item-count">({count})</span>
                                </label>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="catmgr-footer">
                    <span className="catmgr-summary">
                        {t('categories_hidden_count', { hidden: hiddenForTab, total: totalForTab })}
                    </span>
                    <NyxButton
                        variant="primary"
                        size="sm"
                        color="blue"
                        onClick={() => void handleValidate()}
                        data-testid="category-manager-validate"
                        disabled={isSaving}
                    >
                        {isSaving ? '...' : t('btn_validate')}
                    </NyxButton>
                </div>
            </div>
        </div>
    );
};

export default CategoryManagerModal;
