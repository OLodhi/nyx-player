/**
 * Tests pour DashboardPage — Phase 6C2
 *
 * Teste le rendu de base, le mode switcher,
 * la bannière d'alerte IPTV, et les composants principaux.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Variable hoisted pour rendre getDashboardDefaultMode mutable par test
const mockDashboardMode = vi.hoisted(() => ({ value: 'suggestions' }));

// ============================================================================
// MOCKS
// ============================================================================

// Mock i18n
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

// Mock CSS
vi.mock('../DashboardPage.css', () => ({}));

// Mock PlayerContext
const player = vi.hoisted(() => ({ play: vi.fn(async () => {}), setCurrentSeries: vi.fn() }));
vi.mock('../../contexts/PlayerContext', () => ({
    usePlayer: () => player,
}));

// Mock services
vi.mock('../../services/preferencesService', () => ({
    getDashboardDefaultMode: () => mockDashboardMode.value,
}));

vi.mock('../../services/carouselConstants', () => ({
    getGenreName: (id: number) => `Genre ${id}`,
    getCarouselLabel: (key: string) => key,
}));

// Mock hooks
const empty = vi.hoisted(() => ({ list: [] as never[], genres: new Map() }));
const dashboardData = vi.hoisted(() => ({
    loadingHero: false,
    reloading: false,
    // Contenu des rangées TMDB (rail TV) : mêmes tableaux d'un rendu à l'autre, comme le vrai crochet
    content: {} as Record<string, unknown[]>,
    genres: null as Map<number, unknown[]> | null,
    disabled: [] as string[],
}));
vi.mock('../../hooks/useDashboardData', () => ({
    isDashboardReloading: () => dashboardData.reloading,
    useDashboardData: () => ({
        trendingContent: dashboardData.content.trending ?? empty.list,
        nowPlayingContent: dashboardData.content.nowPlaying ?? empty.list,
        onTheAirContent: dashboardData.content.onTheAir ?? empty.list,
        topRatedContent: dashboardData.content.topRated ?? empty.list,
        popularContent: dashboardData.content.popular ?? empty.list,
        genreCarousels: dashboardData.genres ?? empty.genres,
        heroMovies: empty.list,
        loadingHero: dashboardData.loadingHero,
        carouselPrefs: { disabledCarousels: dashboardData.disabled },
        thisWeekMovies: dashboardData.content.thisWeekMovies ?? empty.list,
        thisWeekSeries: dashboardData.content.thisWeekSeries ?? empty.list,
    }),
}));

vi.mock('../../hooks/useHeroRotation', () => ({
    useHeroRotation: () => ({
        heroIndex: 0,
        isFading: false,
        handleDotClick: vi.fn(),
    }),
}));

const continueWatching = vi.hoisted(() => ({ items: [] as { id: number; title: string }[] }));
vi.mock('../../hooks/useContinueWatching', () => ({
    useContinueWatching: () => ({
        continueWatching: continueWatching.items,
    }),
}));

const watchlistData = vi.hoisted(() => ({ items: [] as unknown[], toggle: async () => {} }));
vi.mock('../../hooks/useWatchlistData', () => ({
    useWatchlistData: () => ({
        watchlist: watchlistData.items,
        handleWatchlistToggle: watchlistData.toggle,
    }),
}));

// Mock sub-components as stubs
vi.mock('../../components/Dashboard/VirtualDashboardRow', () => ({
    default: ({ title }: { title: string }) => (
        <div data-testid="virtual-row" data-title={title}>VirtualRow</div>
    ),
}));

vi.mock('../../components/Dashboard/HeroBanner', () => ({
    default: () => <div data-testid="hero-banner">HeroBanner</div>,
}));

vi.mock('../../components/Dashboard/DashboardModeSwitch', () => ({
    default: ({ activeMode, reserved }: { activeMode: string; reserved?: boolean }) => (
        <div data-testid="mode-switch" data-mode={activeMode} data-reserved={String(!!reserved)}>ModeSwitch</div>
    ),
    // Keep DashboardMode type available at runtime
}));

const devMode = vi.hoisted(() => ({ force: null as string | null }));

// Relevé de la fenêtre ouverte par une carte « Introuvable » de « Reprendre »
const continueRow = vi.hoisted(() => ({ onUnavailable: undefined as undefined | ((item: unknown) => void) }));
vi.mock('../../components/Dashboard/ContinueWatchingRow', () => ({
    default: (props: { items: { id: number; title: string }[]; onUnavailable?: (item: unknown) => void }) => {
        continueRow.onUnavailable = props.onUnavailable;
        return (
            <div data-testid="continue-watching" data-nav-row>
                {props.items.map((item) => (
                    <div key={item.id} className="carousel-card" tabIndex={0} aria-label={item.title} />
                ))}
            </div>
        );
    },
}));
// Rail TV : état « dans Ma liste » des cartes, sans base locale
vi.mock('../../hooks/useWatchlistKeys', () => ({
    currentWatchlistKeys: () => null,
    onWatchlistKeys: () => () => {},
}));
const clearUnavailableResume = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('../../services/playbackProgressService', () => ({ clearUnavailableResume }));
const tv = vi.hoisted(() => ({ on: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/platform')>()),
    isTv: () => tv.on,
}));
vi.mock('../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));

vi.mock('../../components/Iptv/LightIptvMode', () => ({
    default: ({ covered }: { covered?: boolean }) => <div data-testid="light-iptv-mode" data-covered={String(!!covered)}>LightIptvMode</div>,
}));

// Mock utils
vi.mock('../../utils/itemHelpers', () => ({
    cleanTitle: (name: string) => name,
}));
vi.mock('../../services/tmdbMatchingService', () => ({}));
vi.mock('../../utils/lightIndexHelpers', () => ({
    getAllVersionsByTmdb: () => [],
}));
vi.mock('../../utils/sourceLanguageSelector', () => ({
    selectBestSourceIndex: () => 0,
}));
vi.mock('../../services/detailFetcher', () => ({
    getMovieDetail: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../i18n/config', () => ({
    default: { language: 'fr' },
}));
vi.mock('../../types/lightIndex', () => ({
    getIconUrl: () => '',
}));

// Mock NavigationContext (« Rechercher » d'un titre « Introuvable »)
vi.mock('../../contexts/NavigationContext', () => ({
    useNavigation: () => ({ setActiveTab: vi.fn(), setSearchQuery: vi.fn() }),
}));

// Mock DevOverrideContext (ajouté au composant pour le DevPanel)
vi.mock('../../contexts/DevOverrideContext', () => ({
    useDevOverrides: () => ({
        overrides: {
            dashboardPage: {
                forceHeroLoading: false,
                forceHeroFading: false,
                forceHeroEmpty: false,
                forceHeroNoLogo: false,
                forceIptvStatus: null,
                forceNoLightIndexes: false,
                forceDashboardMode: devMode.force,
                forceModeSwitching: false,
                forceIptvNoCategories: false,
            },
        },
        setActivePage: vi.fn(),
    }),
}));

// Mock memoryService (scroll listener dans le composant)
vi.mock('../../services/memoryService', () => ({
    requestMemoryPurge: vi.fn(),
}));

// Mock eventConstants (DASHBOARD_RESET_EVENT listener) ; les autres événements restent ceux de l'appli (rail TV)
vi.mock('../../services/eventConstants', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/eventConstants')>()),
    DASHBOARD_RESET_EVENT: 'dashboard:reset',
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import type { LightIndexes } from '../../types/lightIndex';
import DashboardPage, { clearDashboardSessionCache } from '../DashboardPage';
import { rowContentOf } from '../../utils/spatialNavigation/rowHost';
import { remember, rememberedInZone } from '../../utils/spatialNavigation/focusMemory';

// ============================================================================
// TESTS
// ============================================================================

const defaultProps = {
    onNavigateToContent: vi.fn(),
};

describe('DashboardPage', () => {
    afterEach(() => {
        mockDashboardMode.value = 'suggestions';
        dashboardData.loadingHero = false;
        dashboardData.reloading = false;
        devMode.force = null;
        clearDashboardSessionCache();
        continueWatching.items = [];
        tv.on = false;
    });

    // --- Mode suggestions (défaut) ---
    it('se monte sans crash', () => {
        const { container } = render(<DashboardPage {...defaultProps} />);
        expect(container.querySelector('.dashboard-page')).toBeInTheDocument();
    });

    it('TV : les appuis Haut / Bas rapprochés y sont cadencés (page de rangées d’affiches, data-nav-cadence)', () => {
        const { container } = render(<DashboardPage {...defaultProps} />);
        expect(container.querySelector('.dashboard-page')).toHaveAttribute('data-nav-cadence');
    });

    it('affiche le HeroBanner', () => {
        render(<DashboardPage {...defaultProps} />);
        expect(screen.getByTestId('hero-banner')).toBeInTheDocument();
    });

    it('affiche le DashboardModeSwitch en mode suggestions', () => {
        render(<DashboardPage {...defaultProps} />);
        const modeSwitch = screen.getByTestId('mode-switch');
        expect(modeSwitch).toBeInTheDocument();
        expect(modeSwitch).toHaveAttribute('data-mode', 'suggestions');
    });

    it('affiche ContinueWatchingRow en mode suggestions', () => {
        render(<DashboardPage {...defaultProps} />);
        expect(screen.getByTestId('continue-watching')).toBeInTheDocument();
    });

    it('n\'affiche PAS ContinueWatchingRow en mode films', () => {
        mockDashboardMode.value = 'films';
        render(<DashboardPage {...defaultProps} />);
        expect(screen.queryByTestId('continue-watching')).not.toBeInTheDocument();
    });

    // --- Alerte IPTV ---
    it('n\'affiche PAS la bannière d\'alerte quand iptvStatus = ok', () => {
        const { container } = render(<DashboardPage {...defaultProps} iptvStatus="ok" />);
        expect(container.querySelector('.dashboard-status-alert')).not.toBeInTheDocument();
    });

    it('affiche la bannière d\'alerte quand iptvStatus = warning', () => {
        const { container } = render(<DashboardPage {...defaultProps} iptvStatus="warning" />);
        expect(container.querySelector('.dashboard-status-alert')).toBeInTheDocument();
    });

    it('affiche la bannière d\'alerte quand iptvStatus = error', () => {
        const { container } = render(<DashboardPage {...defaultProps} iptvStatus="error" />);
        expect(container.querySelector('.dashboard-status-alert')).toBeInTheDocument();
    });

    // --- Mode films ---
    it('affiche le ModeSwitch en mode films quand getDashboardDefaultMode retourne films', () => {
        mockDashboardMode.value = 'films';
        render(<DashboardPage {...defaultProps} />);
        expect(screen.getByTestId('mode-switch')).toHaveAttribute('data-mode', 'films');
    });

    it('mode films : l\'accueil caché par une fiche est transmis aux rangées (rail TV)', () => {
        mockDashboardMode.value = 'films';
        const lightIndexes = { movies: new Map(), series: new Map(), categories: new Map(), iconPrefixes: [] } as unknown as LightIndexes;
        const { rerender } = render(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} />);
        expect(screen.getByTestId('light-iptv-mode')).toHaveAttribute('data-covered', 'false');
        rerender(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} heroPaused />);
        expect(screen.getByTestId('light-iptv-mode')).toHaveAttribute('data-covered', 'true');
    });

    // --- Onglets pendant le chargement ---
    it('pendant le chargement, hors TV : pas d\'onglets', () => {
        dashboardData.loadingHero = true;
        render(<DashboardPage {...defaultProps} />);
        expect(screen.queryByTestId('mode-switch')).toBeNull();
    });


    // --- Fin du chargement pendant que la personne descend déjà ---
    it('la fin du chargement ne ramène pas en arrière un accueil déjà parcouru', () => {
        mockDashboardMode.value = 'films';
        dashboardData.loadingHero = true;
        const { container, rerender } = render(<DashboardPage {...defaultProps} />);
        const page = container.querySelector('.dashboard-page') as HTMLElement;
        page.scrollTop = 900;

        dashboardData.loadingHero = false;
        rerender(<DashboardPage {...defaultProps} />);

        expect(page.scrollTop).toBe(900);
    });

    // Mémorise une position comme le fait la page au repos : défilement, puis sortie de la page
    const saveScroll = (mode: string, top: number) => {
        devMode.force = mode;
        const { container, unmount } = render(<DashboardPage {...defaultProps} />);
        const page = container.querySelector('.dashboard-page') as HTMLElement;
        page.scrollTop = top;
        fireEvent.scroll(page);
        unmount();
    };

    it('un retour de fiche rend toute la position à la fin du chargement, même si la page était trop courte', () => {
        // Hauteur de page simulée : le navigateur borne scrollTop tant que les rangées ne sont pas là
        const limit = { value: Number.POSITIVE_INFINITY };
        const tops = new WeakMap<Element, number>();
        Object.defineProperty(HTMLDivElement.prototype, 'scrollTop', {
            configurable: true,
            get(this: Element) { return tops.get(this) ?? 0; },
            set(this: Element, v: number) { tops.set(this, Math.min(v, limit.value)); },
        });
        try {
            saveScroll('films', 1200);

            dashboardData.reloading = true;
            dashboardData.loadingHero = true;
            limit.value = 400;
            const { container, rerender } = render(<DashboardPage {...defaultProps} />);
            const page = container.querySelector('.dashboard-page') as HTMLElement;
            expect(page.scrollTop).toBe(400);

            limit.value = Number.POSITIVE_INFINITY;
            dashboardData.loadingHero = false;
            rerender(<DashboardPage {...defaultProps} />);

            expect(page.scrollTop).toBe(1200);
        } finally {
            delete (HTMLDivElement.prototype as { scrollTop?: number }).scrollTop;
        }
    });

    it('un changement d\'onglet pendant le chargement rend la position du nouvel onglet', () => {
        saveScroll('series', 700);

        devMode.force = 'films';
        dashboardData.loadingHero = true;
        const { container, rerender } = render(<DashboardPage {...defaultProps} />);
        const page = container.querySelector('.dashboard-page') as HTMLElement;
        page.scrollTop = 300;

        devMode.force = 'series';
        rerender(<DashboardPage {...defaultProps} />);
        dashboardData.loadingHero = false;
        rerender(<DashboardPage {...defaultProps} />);

        expect(page.scrollTop).toBe(700);
    });

    it('après un changement d\'onglet pendant le chargement, la descente commencée n\'est pas ramenée en arrière', () => {
        saveScroll('series', 700);

        devMode.force = 'films';
        dashboardData.loadingHero = true;
        const { container, rerender } = render(<DashboardPage {...defaultProps} />);
        const page = container.querySelector('.dashboard-page') as HTMLElement;
        page.scrollTop = 300;
        devMode.force = 'series';
        rerender(<DashboardPage {...defaultProps} />);
        page.scrollTop = 500;

        dashboardData.loadingHero = false;
        rerender(<DashboardPage {...defaultProps} />);

        expect(page.scrollTop).toBe(500);
    });

    it('changer d\'onglet rend à chacun sa position', () => {
        saveScroll('series', 500);
        devMode.force = 'films';
        const { container, rerender } = render(<DashboardPage {...defaultProps} />);
        const page = container.querySelector('.dashboard-page') as HTMLElement;
        page.scrollTop = 250;

        devMode.force = 'series';
        rerender(<DashboardPage {...defaultProps} />);

        expect(page.scrollTop).toBe(500);
    });

    // --- Retirer une carte « Introuvable » de « Reprendre » ---
    it('Une carte « Introuvable » ouvre la fenêtre, « Retirer » efface cette reprise', () => {
        const resume = { id: 100, type: 'movie', title: 'Le Film', tmdbId: 1 };
        render(<DashboardPage {...defaultProps} />);
        expect(screen.queryByText('unavailable_message_resume')).not.toBeInTheDocument();

        act(() => continueRow.onUnavailable?.(resume));
        expect(screen.getByText('unavailable_message_resume')).toBeInTheDocument();
        fireEvent.click(screen.getByText('unavailable_remove'));

        expect(clearUnavailableResume).toHaveBeenCalledTimes(1);
        expect(clearUnavailableResume).toHaveBeenCalledWith(resume);
        expect(screen.queryByText('unavailable_message_resume')).not.toBeInTheDocument();
    });

    it('« Fermer » ne retire rien', () => {
        clearUnavailableResume.mockClear();
        render(<DashboardPage {...defaultProps} />);
        act(() => continueRow.onUnavailable?.({ id: 100, type: 'movie', title: 'Le Film', tmdbId: 1 }));
        fireEvent.click(screen.getByText('unavailable_close'));

        expect(clearUnavailableResume).not.toHaveBeenCalled();
        expect(screen.queryByText('unavailable_message_resume')).not.toBeInTheDocument();
    });
});

// ============================================================================
// TV : SUGGESTIONS SUR LE RAIL RECYCLÉ
// ============================================================================

describe('DashboardPage — TV : Suggestions sur le rail recyclé', () => {
    /** Observateur d'intersection simulé : `showRows()` signale tous les emplacements près de l'écran */
    let observed: Element[] = [];
    let report: IntersectionObserverCallback | null = null;
    class FakeIntersection {
        constructor(callback: IntersectionObserverCallback) { report = callback; }
        observe(target: Element) { observed.push(target); }
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    class Inert {
        observe() {}
        unobserve() {}
        disconnect() {}
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
        vi.stubGlobal('IntersectionObserver', FakeIntersection);
        vi.stubGlobal('ResizeObserver', Inert);
        observed = [];
        report = null;
        tv.on = true;
        mockDashboardMode.value = 'suggestions';
        clearUnavailableResume.mockClear();
        player.play.mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        tv.on = false;
        dashboardData.content = {};
        dashboardData.genres = null;
        dashboardData.disabled = [];
        dashboardData.loadingHero = false;
        watchlistData.items = [];
        continueWatching.items = [];
        clearDashboardSessionCache();
    });

    /** Emplacements signalés près de l'écran, puis assez d'images pour que le rail les construise */
    const showRows = () => act(() => {
        report?.(observed.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry), {} as IntersectionObserver);
        for (let i = 0; i < 20; i += 1) vi.advanceTimersByTime(16);
    });
    const places = () => Array.from(document.querySelectorAll<HTMLElement>('.rail-place'));
    /** Rangée affichée dans l'emplacement n° `index` (null : emplacement encore gris) */
    const rowAt = (index: number): HTMLElement | null => {
        const place = places()[index];
        const content = place ? rowContentOf(place) : null;
        return content && content !== place ? content as HTMLElement : null;
    };
    const tmdb = (id: number, title: string) => ({ id, title, image: `https://image.tmdb.org/t/p/w342/${id}.jpg`, type: 'movie', tmdbId: id });
    const catalog = (ids: number[]) => ({
        movies: new Map(ids.map((id) => [id, { id, tmdbId: id * 11 }])),
        series: new Map(),
        moviesByTmdb: new Map(),
        seriesByTmdb: new Map(),
        categories: new Map(),
        iconPrefixes: [],
    }) as unknown as LightIndexes;

    it('les rangées de Suggestions passent par le rail, pas par les rangées React, dans l\'ordre de l\'accueil', () => {
        dashboardData.content = { trending: [tmdb(1, 'Tendance')], nowPlaying: [tmdb(2, 'Récent')] };
        continueWatching.items = [{ id: 3, type: 'movie', title: 'Repris', tmdbId: 33, progress: 40, timeSeconds: 600 } as never];
        const { container } = render(<DashboardPage {...defaultProps} />);
        showRows();

        expect(container.querySelector('.dashboard-content.rail')).not.toBeNull();
        expect(screen.queryByTestId('virtual-row')).toBeNull();
        expect(screen.queryByTestId('continue-watching')).toBeNull();
        // Mêmes repères que la rangée React : le banc lit le nom de la rangée sur le conteneur
        expect([0, 1, 2].map((index) => rowAt(index)?.querySelector('[data-testid="carousel-row"]')?.getAttribute('data-row-title')))
            .toEqual(['carousel_trending', 'carousel_continue', 'carousel_recent_movies']);
        expect(rowAt(0)?.querySelector('[data-testid="carousel-row-title"]')).toHaveTextContent('carousel_trending');
        expect(rowAt(0)?.querySelector('[data-testid="iptv-category"]')).toBeNull();
    });

    it('hors TV, Suggestions garde ses rangées React', () => {
        tv.on = false;
        render(<DashboardPage {...defaultProps} />);
        expect(document.querySelector('.rail')).toBeNull();
        expect(screen.getByTestId('continue-watching')).toBeInTheDocument();
    });

    it('une carte « Reprendre » a sa barre de progression et son bouton lecture, et OK reprend la lecture à sa position', async () => {
        continueWatching.items = [{ id: 3, type: 'movie', title: 'Repris', tmdbId: 33, progress: 40, timeSeconds: 600, containerExtension: 'mkv' } as never];
        render(<DashboardPage {...defaultProps} />);
        showRows();

        const card = rowAt(0)!.querySelector<HTMLElement>('[data-testid="carousel-card"]')!;
        expect(card).toHaveAttribute('aria-label', 'Repris');
        expect(card.querySelector('[data-testid="carousel-card-progress"] .progress-fill')).toHaveStyle({ width: '40%' });
        expect(card.querySelector('[data-testid="carousel-card-play"]')).not.toBeNull();
        fireEvent.keyDown(card, { key: 'Enter' });
        await act(async () => {});

        expect(player.play).toHaveBeenCalledWith(
            expect.objectContaining({ stream_id: 3, container_extension: 'mkv' }),
            undefined,
            600,
            { tmdbId: 33 },
        );
    });

    it('rangées masquées par les préférences et rangées vides absentes ; en chargement, rangée grise sans repère du banc', () => {
        dashboardData.loadingHero = true;
        dashboardData.disabled = ['nowPlaying', 'onTheAir', 'topRated', 'popular'];
        render(<DashboardPage {...defaultProps} />);
        showRows();

        // Seule Tendances attend ses données (Reprendre, Ma liste et les genres sont vides : absents)
        expect(places()).toHaveLength(1);
        const row = rowAt(0)!;
        expect(row.querySelector('[data-testid="carousel-row"]')).toBeNull();
        expect(row.querySelector('.content-carousel-container')).toHaveAttribute('data-row-title', '');
        expect(row.querySelector('.skeleton-title')).not.toHaveAttribute('hidden');
        expect(row.querySelectorAll('.carousel-placeholder-frame').length).toBeGreaterThan(0);
        expect(row.querySelector('[data-testid="carousel-card"]')).toBeNull();
    });

    // La dernière carte retirée emportait la sélection, la télécommande repartait du haut de page
    it('« Reprendre » : la dernière carte retirée passe la sélection à la carte d\'avant', () => {
        const first = { id: 1, type: 'movie', title: 'Premier', tmdbId: 11, progress: 10 };
        const last = { id: 2, type: 'movie', title: 'Dernier', tmdbId: 22, progress: 10 };
        const lightIndexes = catalog([1]);
        continueWatching.items = [first, last] as never[];
        const { rerender } = render(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} />);
        showRows();
        const lastCard = screen.getByLabelText('Dernier');
        lastCard.focus();

        // Titre plus au catalogue : la carte ouvre la fenêtre Rechercher / Retirer
        fireEvent.click(lastCard);
        fireEvent.click(screen.getByText('unavailable_remove'));
        expect(clearUnavailableResume).toHaveBeenCalledWith(last);
        continueWatching.items = [first] as never[];
        rerender(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} />);

        expect(document.activeElement).toBe(screen.getByLabelText('Premier'));
    });

    // Les cartes sont repérées par leur rang, dans la rangée React comme dans le rail : la sélection reste au même rang
    // et la carte suivante glisse dessous
    it('« Reprendre » : retirer une carte d\'avant laisse la sélection au même rang, la suivante glisse dessous', () => {
        const first = { id: 1, type: 'movie', title: 'Premier', tmdbId: 11, progress: 10 };
        const second = { id: 2, type: 'movie', title: 'Second', tmdbId: 22, progress: 10 };
        const third = { id: 3, type: 'movie', title: 'Troisième', tmdbId: 33, progress: 10 };
        const lightIndexes = catalog([2, 3]);
        continueWatching.items = [first, second, third] as never[];
        const { rerender } = render(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} />);
        showRows();
        const selected = screen.getByLabelText('Second');
        selected.focus();
        // Un clic n'y déplace pas la sélection : elle reste sur « Second »
        fireEvent.click(screen.getByLabelText('Premier'));
        fireEvent.click(screen.getByText('unavailable_remove'));
        expect(clearUnavailableResume).toHaveBeenCalledWith(first);
        continueWatching.items = [second, third] as never[];
        rerender(<DashboardPage {...defaultProps} lightIndexes={lightIndexes} />);

        expect(document.activeElement).toBe(selected);
        expect(selected).toHaveAttribute('aria-label', 'Troisième');
    });

    // Leur arrivée à la fin du chargement décalait les rangées en plein défilement
    it('pendant le chargement, sur TV : la place des onglets est gardée, puis les mêmes onglets apparaissent', () => {
        dashboardData.loadingHero = true;
        const { rerender } = render(<DashboardPage {...defaultProps} />);
        const reserved = screen.getByTestId('mode-switch');
        expect(reserved).toHaveAttribute('data-reserved', 'true');
        dashboardData.loadingHero = false;
        rerender(<DashboardPage {...defaultProps} />);
        expect(screen.getByTestId('mode-switch')).toBe(reserved);
        expect(reserved).toHaveAttribute('data-reserved', 'false');
    });

    it('l\'accueil caché par une fiche est transmis au rail de Suggestions', () => {
        dashboardData.content = { trending: [tmdb(1, 'Tendance')] };
        const { rerender, container } = render(<DashboardPage {...defaultProps} />);
        showRows();
        const rail = container.querySelector('.rail');
        rerender(<DashboardPage {...defaultProps} heroPaused />);
        // Même rail (pas recréé) : la fiche se pose par-dessus
        expect(container.querySelector('.rail')).toBe(rail);
        expect(rowAt(0)).not.toBeNull();
    });
    // Tout en bas, Retour puis OK sur Accueil remontait la page, mais Droite
    // ramenait sur la carte quittée en bas au lieu de la bannière
    it('TV : Accueil cliqué sur l\'accueil oublie la carte quittée, Droite depuis la barre entre par la bannière', () => {
        render(<DashboardPage {...defaultProps} />);
        const deepCard = document.createElement('button');
        document.body.appendChild(deepCard);
        remember(deepCard);
        expect(rememberedInZone('content')).toBe(deepCard);

        act(() => {
            window.dispatchEvent(new CustomEvent('dashboard:reset'));
        });

        expect(rememberedInZone('content')).toBeUndefined();
        deepCard.remove();
    });
});
