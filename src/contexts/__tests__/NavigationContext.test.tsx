/**
 * Tests pour NavigationContext
 *
 * Teste les valeurs initiales, le guard useNavigation hors provider,
 * la navigation entre tabs, la navigation vers films/séries/catégories,
 * le stack de navigation (goBack), et les actions close.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

// ============================================================================
// MOCKS
// ============================================================================

vi.mock('../../services/preferencesService', () => ({
    getHomePage: vi.fn().mockReturnValue('dashboard'),
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import { NavigationProvider, useNavigation } from '../NavigationContext';

// ============================================================================
// TEST CONSUMER
// ============================================================================

const TestConsumer: React.FC = () => {
    const nav = useNavigation();
    return (
        <div>
            <span data-testid="active-tab">{nav.activeTab}</span>
            <span data-testid="selected-movie">{nav.selectedMovie ? JSON.stringify(nav.selectedMovie) : 'null'}</span>
            <span data-testid="selected-series">{nav.selectedSeries ? 'set' : 'null'}</span>
            <span data-testid="category-detail">{nav.categoryDetail ? nav.categoryDetail.categoryName : 'null'}</span>
            <span data-testid="search-query">{nav.searchQuery || 'empty'}</span>
            <span data-testid="active-category-id">{nav.activeCategoryId}</span>
            <span data-testid="stack-size">{nav.navigationStack.length}</span>

            {/* Actions */}
            <button data-testid="btn-tab-live" onClick={() => nav.setActiveTab('live')}>Live</button>
            <button data-testid="btn-tab-search" onClick={() => nav.setActiveTab('search')}>Search</button>
            <button data-testid="btn-navigate-movie" onClick={() => nav.navigateToMovie(123, [{ stream_id: 1 } as never])}>Movie</button>
            <button data-testid="btn-navigate-series" onClick={() => nav.navigateToSeries({ series_id: 456, name: 'Test Series' } as never)}>Series</button>
            <button data-testid="btn-navigate-category" onClick={() => nav.navigateToCategory({
                categoryId: 'cat1',
                categoryName: 'Action',
                items: [],
                type: 'movies',
            })}>Category</button>
            <button data-testid="btn-go-back" onClick={() => nav.goBack()}>Back</button>
            <button data-testid="btn-close-movie" onClick={() => nav.closeMovieDetail()}>CloseMovie</button>
            <button data-testid="btn-close-series" onClick={() => nav.closeSeriesDetail()}>CloseSeries</button>
            <button data-testid="btn-close-category" onClick={() => nav.closeCategoryDetail()}>CloseCategory</button>
            <button data-testid="btn-set-search" onClick={() => nav.setSearchQuery('test query')}>SetSearch</button>
            <button data-testid="btn-set-category-id" onClick={() => nav.setActiveCategoryId('sports')}>SetCatId</button>
        </div>
    );
};

// ============================================================================
// TESTS
// ============================================================================

describe('NavigationContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================================================
    // INITIAL STATE
    // =========================================================================

    it('fournit les valeurs initiales correctes', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        expect(screen.getByTestId('active-tab')).toHaveTextContent('dashboard');
        expect(screen.getByTestId('selected-movie')).toHaveTextContent('null');
        expect(screen.getByTestId('selected-series')).toHaveTextContent('null');
        expect(screen.getByTestId('category-detail')).toHaveTextContent('null');
        expect(screen.getByTestId('search-query')).toHaveTextContent('empty');
        expect(screen.getByTestId('active-category-id')).toHaveTextContent('all');
        expect(screen.getByTestId('stack-size')).toHaveTextContent('0');
    });

    it('useNavigation() hors du provider lance une erreur', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        expect(() => render(<TestConsumer />)).toThrow(
            'useNavigation must be used within a NavigationProvider'
        );
        spy.mockRestore();
    });

    // =========================================================================
    // TAB NAVIGATION
    // =========================================================================

    it('setActiveTab change le tab actif', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-tab-live').click();
        });

        expect(screen.getByTestId('active-tab')).toHaveTextContent('live');
    });

    it('setActiveTab reset les détails ouverts', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        // Navigate to a movie first
        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });
        expect(screen.getByTestId('selected-movie')).not.toHaveTextContent('null');

        // Switch tab — should reset movie
        act(() => {
            screen.getByTestId('btn-tab-search').click();
        });
        expect(screen.getByTestId('active-tab')).toHaveTextContent('search');
        expect(screen.getByTestId('selected-movie')).toHaveTextContent('null');
        expect(screen.getByTestId('stack-size')).toHaveTextContent('0');
    });

    // =========================================================================
    // NAVIGATE TO CONTENT
    // =========================================================================

    it('navigateToMovie ouvre un film', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });

        const movieState = screen.getByTestId('selected-movie').textContent;
        expect(movieState).toContain('123');
        expect(screen.getByTestId('selected-series')).toHaveTextContent('null');
    });

    it('navigateToSeries ouvre une série et ferme le film', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        // Open movie
        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });

        // Open series (should close movie)
        act(() => {
            screen.getByTestId('btn-navigate-series').click();
        });

        expect(screen.getByTestId('selected-series')).toHaveTextContent('set');
        expect(screen.getByTestId('selected-movie')).toHaveTextContent('null');
    });

    it('navigateToCategory ouvre une catégorie', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-navigate-category').click();
        });

        expect(screen.getByTestId('category-detail')).toHaveTextContent('Action');
    });

    // =========================================================================
    // NAVIGATION STACK (goBack)
    // =========================================================================

    it('goBack restaure le film précédent depuis la pile', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        // Movie → Series (pushes movie on stack)
        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });
        act(() => {
            screen.getByTestId('btn-navigate-series').click();
        });

        expect(screen.getByTestId('selected-series')).toHaveTextContent('set');
        expect(screen.getByTestId('stack-size')).toHaveTextContent('1');

        // Go back → should restore movie
        act(() => {
            screen.getByTestId('btn-go-back').click();
        });

        expect(screen.getByTestId('selected-movie')).not.toHaveTextContent('null');
        expect(screen.getByTestId('selected-series')).toHaveTextContent('null');
        expect(screen.getByTestId('stack-size')).toHaveTextContent('0');
    });

    it('goBack sans stack ferme tous les détails', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        // Open movie directly (no stack)
        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });

        // Go back with empty stack → close everything
        act(() => {
            screen.getByTestId('btn-go-back').click();
        });

        expect(screen.getByTestId('selected-movie')).toHaveTextContent('null');
        expect(screen.getByTestId('selected-series')).toHaveTextContent('null');
        expect(screen.getByTestId('category-detail')).toHaveTextContent('null');
    });

    // =========================================================================
    // CLOSE ACTIONS
    // =========================================================================

    it('closeMovieDetail ferme le film sans toucher le stack', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-navigate-movie').click();
        });
        expect(screen.getByTestId('selected-movie')).not.toHaveTextContent('null');

        act(() => {
            screen.getByTestId('btn-close-movie').click();
        });
        expect(screen.getByTestId('selected-movie')).toHaveTextContent('null');
    });

    it('closeSeriesDetail ferme la série', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-navigate-series').click();
        });
        act(() => {
            screen.getByTestId('btn-close-series').click();
        });
        expect(screen.getByTestId('selected-series')).toHaveTextContent('null');
    });

    it('closeCategoryDetail ferme la catégorie', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-navigate-category').click();
        });
        act(() => {
            screen.getByTestId('btn-close-category').click();
        });
        expect(screen.getByTestId('category-detail')).toHaveTextContent('null');
    });

    // =========================================================================
    // SEARCH & CATEGORY
    // =========================================================================

    it('setSearchQuery met à jour la query', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-set-search').click();
        });
        expect(screen.getByTestId('search-query')).toHaveTextContent('test query');
    });

    it('setActiveCategoryId met à jour la catégorie TV', () => {
        render(
            <NavigationProvider>
                <TestConsumer />
            </NavigationProvider>
        );

        act(() => {
            screen.getByTestId('btn-set-category-id').click();
        });
        expect(screen.getByTestId('active-category-id')).toHaveTextContent('sports');
    });
});
