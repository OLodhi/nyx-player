/**
 * NavigationContext - Gestion centralisée de la navigation
 *
 * CONTEXTE:
 * Avant ce refactor, App.tsx gérait directement l'état de navigation via
 * plusieurs useState éparpillés. Ce contexte centralise :
 * - Tab actif (dashboard, live, watchlist, search, settings)
 * - États des pages de détail (selectedMovie, selectedSeries, categoryDetail)
 * - Actions de navigation (naviguer vers film, série, catégorie)
 */

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import type { IptvStream, IptvSeries } from '../types/iptv';
import type { XtreamMovie, AppSeriesInfo } from '../types/xtream';
import { getHomePage } from '../services/preferencesService';
import { devLog } from '../utils/devLog';
import { forceMemoryPurge } from '../services/memoryService';
import { notifyTabChange } from '../services/calmMoments';
import { clearDashboardSessionCache } from '../pages/DashboardPage';

// ============================================================================
// TYPES
// ============================================================================

// Re-exporté depuis types/navigation pour rétro-compatibilité
import type { TabType } from '../types/navigation';
export type { TabType };

/** État pour la page de détail film */
interface SelectedMovieState {
    tmdbId: number;
    versions: XtreamMovie[];
}

/** État pour la page de détail catégorie (IPTV "Voir tout") */
interface CategoryDetailState {
    categoryId: string;
    categoryName: string;
    items: IptvStream[] | IptvSeries[];
    type: 'movies' | 'series';
}

/**
 * Entrée de l'historique de navigation.
 * Stocke l'état d'une page visitée pour permettre le retour arrière.
 */
type NavigationEntryType = 'movie' | 'series' | 'category';

interface NavigationEntry {
    type: NavigationEntryType;
    /** État film (si type === 'movie') */
    movie?: SelectedMovieState;
    /** État série (si type === 'series') */
    series?: AppSeriesInfo;
    /** État catégorie (si type === 'category') */
    category?: CategoryDetailState;
}

/**
 * État du contexte Navigation
 */
interface NavigationState {
    /** Tab actif */
    activeTab: TabType;
    /** Film sélectionné pour la page de détail */
    selectedMovie: SelectedMovieState | null;
    /** Série sélectionnée pour la page de détail */
    selectedSeries: AppSeriesInfo | null;
    /** Catégorie sélectionnée pour la page "Voir tout" */
    categoryDetail: CategoryDetailState | null;

    /** Query de recherche globale */
    searchQuery: string;
    /** Catégorie active (pour TV live) */
    activeCategoryId: string;
    /** Stack de navigation pour bouton retour (LIFO) */
    navigationStack: NavigationEntry[];
}

/**
 * Actions du contexte Navigation
 */
interface NavigationActions {
    /** Changer de tab */
    setActiveTab: (tab: TabType) => void;
    /** Naviguer vers la page de détail d'un film */
    navigateToMovie: (tmdbId: number, versions: XtreamMovie[]) => void;
    /** Naviguer vers la page de détail d'une série */
    navigateToSeries: (series: AppSeriesInfo) => void;
    /** Naviguer vers la page "Voir tout" d'une catégorie */
    navigateToCategory: (detail: CategoryDetailState) => void;
    /** Retour depuis une page de détail */
    goBack: () => void;
    /** Fermer la page de détail film */
    closeMovieDetail: () => void;
    /** Fermer la page de détail série */
    closeSeriesDetail: () => void;
    /** Fermer la page de catégorie */
    closeCategoryDetail: () => void;
    /** Mettre à jour la query de recherche */
    setSearchQuery: (query: string) => void;
    /** Mettre à jour la catégorie active */
    setActiveCategoryId: (id: string) => void;
}

type NavigationContextValue = NavigationState & NavigationActions;

// ============================================================================
// CONTEXT
// ============================================================================

const NavigationContext = createContext<NavigationContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface NavigationProviderProps {
    children: ReactNode;
}

export const NavigationProvider: React.FC<NavigationProviderProps> = ({ children }) => {
    // État — homePage lue depuis userPreferences au démarrage
    const [activeTab, setActiveTabState] = useState<TabType>(() => getHomePage());
    const [selectedMovie, setSelectedMovie] = useState<SelectedMovieState | null>(null);
    const [selectedSeries, setSelectedSeries] = useState<AppSeriesInfo | null>(null);
    const [categoryDetail, setCategoryDetail] = useState<CategoryDetailState | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategoryId, setActiveCategoryId] = useState<string>('all');

    // Stack de navigation pour bouton retour
    const [navigationStack, setNavigationStack] = useState<NavigationEntry[]>([]);

    // =========================================================================
    // ACTIONS
    // =========================================================================

    /**
     * Push l'état actuel sur le stack avant navigation.
     * Ne push pas si on est sur une page racine (aucun détail ouvert).
     */
    const pushCurrentStateToStack = useCallback(() => {
        // Déterminer quel état actuel sauvegarder
        if (selectedMovie) {
            setNavigationStack(prev => [...prev, {
                type: 'movie' as NavigationEntryType,
                movie: selectedMovie,
            }]);
        } else if (selectedSeries) {
            setNavigationStack(prev => [...prev, {
                type: 'series' as NavigationEntryType,
                series: selectedSeries,
            }]);
        } else if (categoryDetail) {
            setNavigationStack(prev => [...prev, {
                type: 'category' as NavigationEntryType,
                category: categoryDetail,
            }]);
        }
        // Si aucun détail ouvert = page racine, on ne push rien
    }, [selectedMovie, selectedSeries, categoryDetail]);

    /**
     * Changer de tab - RESET le stack de navigation
     */
    const setActiveTab = useCallback((tab: TabType) => {
        devLog('nav', `Tab → ${tab}`);
        // Moment calme : un catalogue neuf, préparé en arrière-plan, s'installe avec le nouvel onglet
        notifyTabChange();
        forceMemoryPurge(); // Purge les bitmaps de la page précédente
        setNavigationStack([]); // Reset stack
        setSelectedMovie(null);
        setSelectedSeries(null);
        setCategoryDetail(null);
        clearDashboardSessionCache(); // Reset la session du Dashboard (ex: mode, scroll) en cas de retour ultérieur
        setActiveTabState(tab);
    }, []);

    const navigateToMovie = useCallback((tmdbId: number, versions: XtreamMovie[]) => {
        devLog('nav', `→ Movie (tmdbId: ${tmdbId}, ${versions.length} version${versions.length > 1 ? 's' : ''})`);
        forceMemoryPurge(); // Purge les bitmaps des carrousels
        // Push l'état actuel avant de naviguer (si on est sur un détail)
        pushCurrentStateToStack();
        // Navigation immédiate
        setSelectedMovie({ tmdbId, versions });
        setSelectedSeries(null); // Fermer série si ouverte
    }, [pushCurrentStateToStack]);

    const navigateToSeries = useCallback((series: AppSeriesInfo) => {
        devLog('nav', `→ Series (${series.name})`);
        forceMemoryPurge(); // Purge les bitmaps des carrousels
        // Push l'état actuel avant de naviguer
        pushCurrentStateToStack();
        // Navigation immédiate
        setSelectedSeries(series);
        setSelectedMovie(null); // Fermer film si ouvert
    }, [pushCurrentStateToStack]);

    const navigateToCategory = useCallback((detail: CategoryDetailState) => {
        devLog('nav', `→ Category "${detail.categoryName}" (${detail.type})`);
        forceMemoryPurge(); // Purge les bitmaps des carrousels
        // Push l'état actuel avant de naviguer
        pushCurrentStateToStack();
        setCategoryDetail(detail);
        setSelectedMovie(null); // Fermer film si ouvert
        setSelectedSeries(null); // Fermer série si ouverte
    }, [pushCurrentStateToStack]);

    /**
     * Retour arrière - Pop le stack et restaure l'état précédent
     */
    const goBack = useCallback(() => {
        devLog('nav', `← Retour (stack: ${navigationStack.length})`);
        forceMemoryPurge(); // Purge les bitmaps de la page de détail
        if (navigationStack.length > 0) {
            // Pop la dernière entrée du stack
            const newStack = [...navigationStack];
            const lastEntry = newStack.pop();
            setNavigationStack(newStack);

            // Restaurer l'état (guard contre undefined même si garanti par length check)
            if (!lastEntry) return;

            if (lastEntry.type === 'movie' && lastEntry.movie) {
                setSelectedMovie(lastEntry.movie);
                setSelectedSeries(null);
                setCategoryDetail(null);
            } else if (lastEntry.type === 'series' && lastEntry.series) {
                setSelectedSeries(lastEntry.series);
                setSelectedMovie(null);
                setCategoryDetail(null);
            } else if (lastEntry.type === 'category' && lastEntry.category) {
                setCategoryDetail(lastEntry.category);
                setSelectedMovie(null);
                setSelectedSeries(null);
            }
        } else {
            // Stack vide = retour à la page racine
            setSelectedMovie(null);
            setSelectedSeries(null);
            setCategoryDetail(null);
        }
    }, [navigationStack]);

    const closeMovieDetail = useCallback(() => {
        setSelectedMovie(null);
    }, []);

    const closeSeriesDetail = useCallback(() => {
        setSelectedSeries(null);
    }, []);

    const closeCategoryDetail = useCallback(() => {
        setCategoryDetail(null);
    }, []);

    const value: NavigationContextValue = useMemo(() => ({
        // State
        activeTab,
        selectedMovie,
        selectedSeries,
        categoryDetail,
        searchQuery,
        activeCategoryId,
        navigationStack,
        // Actions
        setActiveTab,
        navigateToMovie,
        navigateToSeries,
        navigateToCategory,
        goBack,
        closeMovieDetail,
        closeSeriesDetail,
        closeCategoryDetail,
        setSearchQuery,
        setActiveCategoryId,
    }), [
        activeTab, selectedMovie, selectedSeries, categoryDetail,
        searchQuery, activeCategoryId, navigationStack,
        setActiveTab, navigateToMovie, navigateToSeries, navigateToCategory,
        goBack, closeMovieDetail, closeSeriesDetail, closeCategoryDetail,
    ]);

    return (
        <NavigationContext.Provider value={value}>
            {children}
        </NavigationContext.Provider>
    );
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook pour accéder au contexte Navigation.
 * @throws Error si utilisé hors du NavigationProvider
 */
export function useNavigation(): NavigationContextValue {
    const context = useContext(NavigationContext);
    if (!context) {
        throw new Error('useNavigation must be used within a NavigationProvider');
    }
    return context;
}


