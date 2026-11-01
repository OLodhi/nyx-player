/**
 * Rotation de la bannière de l'accueil : elle ne doit redessiner que la bannière, pas les rangées.
 * Avant, chaque film suivant (toutes les 18 s, deux changements d'état) redessinait tout l'accueil,
 * ce qui faisait saccader le Chromecast.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

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
vi.mock('../../contexts/PlayerContext', () => ({
    usePlayer: () => ({
        play: vi.fn(),
        setCurrentSeries: vi.fn(),
    }),
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
// Même tableau de films à chaque rendu (comme le vrai hook) : un nouveau tableau relancerait la rotation
const data = vi.hoisted(() => ({
    heroMovies: [
        { id: 1, title: 'Film A', backdrop: '', overview: '' },
        { id: 2, title: 'Film B', backdrop: '', overview: '' },
        { id: 3, title: 'Film C', backdrop: '', overview: '' },
    ],
    trending: [{ id: 10, title: 'Tendance', image: '', type: 'movie' }],
    // Identités stables, comme celles du vrai hook (useCallback / état)
    watchlist: [] as unknown[],
    vide: [] as unknown[],
    genres: new Map(),
    toggle: (() => Promise.resolve()) as (...a: unknown[]) => Promise<void>,
}));
vi.mock('../../hooks/useDashboardData', () => ({
    useDashboardData: () => ({
        trendingContent: data.trending,
        nowPlayingContent: data.vide,
        onTheAirContent: data.vide,
        topRatedContent: data.vide,
        popularContent: data.vide,
        genreCarousels: data.genres,
        heroMovies: data.heroMovies,
        loadingHero: false,
        carouselPrefs: { disabledCarousels: [] },
        thisWeekMovies: data.vide,
        thisWeekSeries: data.vide,
    }),
}));

const continueWatching = vi.hoisted(() => ({ items: [] as { id: number; title: string }[] }));
vi.mock('../../hooks/useContinueWatching', () => ({
    useContinueWatching: () => ({
        continueWatching: continueWatching.items,
    }),
}));

vi.mock('../../hooks/useWatchlistData', () => ({
    useWatchlistData: () => ({
        watchlist: data.watchlist,
        handleWatchlistToggle: data.toggle,
    }),
}));

// Mock sub-components as stubs
const rendus = vi.hoisted(() => ({ rangees: 0, films: [] as string[], items: [] as unknown[] }));
vi.mock('../../components/Dashboard/VirtualDashboardRow', () => ({
    default: ({ title, items }: { title: string; items: unknown }) => {
        rendus.rangees += 1;
        rendus.items.push(items);
        return <div data-testid="virtual-row" data-title={title}>VirtualRow</div>;
    },
}));

vi.mock('../../components/Dashboard/HeroBanner', () => ({
    default: ({ movie }: { movie: { title: string } | null }) => {
        rendus.films.push(movie?.title ?? '');
        return <div data-testid="hero-banner">{movie?.title}</div>;
    },
}));

vi.mock('../../components/Dashboard/DashboardModeSwitch', () => ({
    default: ({ activeMode }: { activeMode: string }) => (
        <div data-testid="mode-switch" data-mode={activeMode}>ModeSwitch</div>
    ),
    // Keep DashboardMode type available at runtime
}));

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
const clearUnavailableResume = vi.hoisted(() => vi.fn(async () => 1));
vi.mock('../../services/playbackProgressService', () => ({ clearUnavailableResume }));
const tv = vi.hoisted(() => ({ on: false }));
vi.mock('../../utils/platform', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../utils/platform')>()),
    isTv: () => tv.on,
}));
vi.mock('../../hooks/useBackHandler', () => ({ useBackHandler: () => {} }));

vi.mock('../../components/Iptv/LightIptvMode', () => ({
    default: () => <div data-testid="light-iptv-mode">LightIptvMode</div>,
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
                forceDashboardMode: null,
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

import DashboardPage from '../DashboardPage';

describe('DashboardPage — rotation de la bannière', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        rendus.rangees = 0;
        rendus.films = [];
        rendus.items = [];
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('passe au film suivant sans redessiner les rangées', () => {
        render(<DashboardPage onNavigateToContent={vi.fn()} />);
        expect(screen.getByTestId('hero-banner').textContent).toBe('Film A');
        const rangeesAvant = rendus.rangees;
        expect(rangeesAvant).toBeGreaterThan(0);

        // 18 s puis le fondu de 0,5 s : film suivant
        act(() => { vi.advanceTimersByTime(18_000 + 500); });
        expect(screen.getByTestId('hero-banner').textContent).toBe('Film B');
        act(() => { vi.advanceTimersByTime(18_000 + 500); });
        expect(screen.getByTestId('hero-banner').textContent).toBe('Film C');

        expect(rendus.rangees).toBe(rangeesAvant);
    });

    it('garde les mêmes cartes quand la page se redessine pour une autre raison', () => {
        render(<DashboardPage onNavigateToContent={vi.fn()} />);
        const avant = rendus.items.length;
        expect(avant).toBeGreaterThan(0);
        const premier = rendus.items[0];

        // Ouvre la fenêtre « titre indisponible » : un changement d'état de la page, sans nouvelles données
        act(() => { continueRow.onUnavailable?.({ id: 1, title: 'X' }); });

        expect(rendus.items.length).toBeGreaterThan(avant);
        expect(new Set(rendus.items).size).toBe(avant);
        expect(rendus.items[rendus.items.length - avant]).toBe(premier);
    });

    it('appelle la dernière navigation reçue au clic sur une carte', () => {
        const premiere = vi.fn();
        const seconde = vi.fn();
        const { rerender } = render(<DashboardPage onNavigateToContent={premiere} />);
        const items = rendus.items[0] as { onClick: () => void }[];
        rerender(<DashboardPage onNavigateToContent={seconde} />);

        // Les cartes gardent leur identité (mémoïsées) mais le clic va à la navigation à jour
        items[0].onClick();
        expect(premiere).not.toHaveBeenCalled();
        expect(seconde).toHaveBeenCalledWith('movie', { tmdbId: 0, streamId: 10 });
    });
});
