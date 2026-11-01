/**
 * Tests pour App.tsx — Phase 1.5
 *
 * Teste le rendu conditionnel : ProfileSelector → Login → App principale,
 * le logout Supabase, et l'écran de chargement.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';

// ============================================================================
// MOCKS
// ============================================================================

// Mock i18n
vi.mock('react-i18next', () => ({
    // Chargé par i18n/config (via preferencesService → carouselConstants → tmdbLanguage)
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: {
            on: vi.fn(),
            off: vi.fn(),
            language: 'fr',
        },
    }),
}));

// Mock CSS
vi.mock('../App.css', () => ({}));
vi.mock('../pages/SupabaseAuthPage.css', () => ({}));
vi.mock('../pages/ProfileSelectorPage.css', () => ({}));

// Mock Supabase Auth — simuler une session active par défaut
const mockSupabaseSignOut = vi.fn();
vi.mock('../contexts/SupabaseAuthContext', () => ({
    useSupabaseAuth: () => ({
        user: { id: 'test-user-id', email: 'test@test.com' },
        session: { access_token: 'test-jwt-token', user: { id: 'test-user-id' } },
        loading: false,
        signIn: vi.fn(),
        signUp: vi.fn(),
        signOut: mockSupabaseSignOut,
    }),
}));

// Mock SupabaseAuthPage
vi.mock('../pages/SupabaseAuthPage', () => ({
    default: () => <div data-testid="supabase-auth-page">SupabaseAuth</div>,
}));

// Mock services
vi.mock('../services/initDevTools', () => ({}));
vi.mock('../services/tmdbCacheSqlite', () => ({
    clearAllCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/detailFetcher', () => ({
    getMovieDetail: vi.fn(),
    getSeriesDetail: vi.fn(),
}));

// Mock profileService
const TEST_PROFILE = {
    id: 'profile-1',
    user_id: 'test-user-id',
    display_name: 'Profile 1',
    avatar_color: '#F4A8A8',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
};
const mockEnsureDefaultProfile = vi.fn().mockResolvedValue([TEST_PROFILE]);
const mockSetActiveProfileSupabase = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/profileService', async (importOriginal) => ({
    needsActiveProfileUpdate: (await importOriginal<typeof import('../services/profileService')>()).needsActiveProfileUpdate,
    loadProfiles: async (...args: unknown[]) => ({ profiles: await mockEnsureDefaultProfile(...args), offline: false }),
    setActiveProfile: (...args: unknown[]) => mockSetActiveProfileSupabase(...args),
}));

// Mock SessionContext
const mockSessionValues = {
    isLoggedIn: false,
    isLoading: false,
    isLoadingSavedData: false,
    progress: 0,
    hasSavedSession: false,
    isCheckingSavedSession: false,
    lightIndexes: null,
    iptvStatus: 'ok' as const,
    homeTab: 'dashboard' as const,
    credentials: null,
    accountInfo: null,
    activeProfileId: null,
    sourceChanged: false,
    login: vi.fn(),
    resumeSession: vi.fn(),
    logout: vi.fn(),
    startFresh: vi.fn(),
    refreshSources: vi.fn(),
    updateCredentials: vi.fn(),
    settingsContentCounts: undefined,
    setActiveTabAfterAuth: vi.fn(),
    selectProfile: vi.fn().mockResolvedValue(undefined),
    fullReset: vi.fn(),
    pendingProviderChange: null,
    confirmProviderChange: vi.fn(),
    sessionError: null,
    clearSessionError: vi.fn(),
};

vi.mock('../contexts/SessionContext', () => ({
    useSession: () => mockSessionValues,
}));

// Mock NavigationContext (l'onglet actif et son setter se règlent dans un test)
const mockNavigation = vi.hoisted(() => ({ activeTab: 'dashboard', setActiveTab: vi.fn() }));
vi.mock('../contexts/NavigationContext', () => ({
    useNavigation: () => ({
        activeTab: mockNavigation.activeTab,
        setActiveTab: mockNavigation.setActiveTab,
        selectedMovie: null,
        navigateToMovie: vi.fn(),
        closeMovieDetail: vi.fn(),
        selectedSeries: null,
        closeSeriesDetail: vi.fn(),
        categoryDetail: null,
        navigateToCategory: vi.fn(),
        searchQuery: '',
        setSearchQuery: vi.fn(),
        activeCategoryId: 'all',
        setActiveCategoryId: vi.fn(),
        goBack: vi.fn(),
    }),
}));

// Mock PlayerContext
vi.mock('../contexts/PlayerContext', () => ({
    usePlayer: () => ({
        currentlyPlaying: null,
        mpvConnected: false,
        isTransitioningToPlayer: false,
        stop: vi.fn(),
        play: vi.fn(),
        setCurrentSeries: vi.fn(),
    }),
}));

// Mock hooks
vi.mock('../hooks/useLiveTvCategories', () => ({
    useLiveTvCategories: () => ({
        selectedCategory: 'all',
        setSelectedCategory: vi.fn(),
        pinnedCategories: [],
        togglePin: vi.fn(),
    }),
}));

vi.mock('../hooks/useEpisodeNavigation', () => ({
    useEpisodeNavigation: () => ({
        playerTitle: '',
        contentId: null,
        resolvedTmdbId: undefined,
        onNextEpisode: undefined,
        onPrevEpisode: undefined,
        seriesMetadata: undefined,
    }),
}));

vi.mock('../hooks/useContentNavigation', () => ({
    useContentNavigation: () => ({
        navigateToContent: vi.fn(),
    }),
    cancelPendingOpen: vi.fn(),
}));

// Mock DevOverrideContext
vi.mock('../contexts/DevOverrideContext', () => ({
    useDevOverrides: () => ({
        overrides: {
            loginPage: {},
            xtreamPage: {},
            watchlistPage: {},
            globalSearchPage: {},
            settingsPage: {},
            liveTvPage: { forceLoading: false, forceEmpty: false, forceError: null },
            activePage: 'unknown',
        },
        setActivePage: vi.fn(),
        setLoginOverride: vi.fn(),
        resetLoginOverrides: vi.fn(),
        setXtreamOverride: vi.fn(),
        resetXtreamOverrides: vi.fn(),
        setWatchlistOverride: vi.fn(),
        resetWatchlistOverrides: vi.fn(),
        setGlobalSearchOverride: vi.fn(),
        resetGlobalSearchOverrides: vi.fn(),
        setSettingsOverride: vi.fn(),
        resetSettingsOverrides: vi.fn(),
        setLiveTvOverride: vi.fn(),
        resetLiveTvOverrides: vi.fn(),
        resetAll: vi.fn(),
        isDevMode: false,
    }),
}));

// Mock UpdaterContext
vi.mock('../contexts/UpdaterContext', () => ({
    useUpdater: () => ({
        status: 'idle',
        version: null,
        notes: null,
        progress: 0,
        error: null,
        checkForUpdate: vi.fn(),
        installUpdate: vi.fn(),
        dismiss: vi.fn(),
    }),
}));

vi.mock('../utils/lightIndexHelpers', () => ({
    getAllVersionsByTmdb: vi.fn().mockReturnValue([]),
}));

// Mock child components as stubs
vi.mock('../components/Login', () => ({
    default: () => <div data-testid="login-component">Login</div>,
}));

vi.mock('../components/Navigation/Sidebar', () => ({
    default: ({ onLogout }: { onLogout: () => void }) => (
        <div data-testid="sidebar">
            <button type="button" onClick={onLogout}>{'sidebar-logout'}</button>
        </div>
    ),
}));
vi.mock('../components/Navigation/TvCategoriesSidebar', () => ({
    default: () => <div data-testid="tv-categories-sidebar">TvCategoriesSidebar</div>,
}));
vi.mock('../components/PlayerControls', () => ({
    default: () => <div data-testid="player-controls">PlayerControls</div>,
}));
vi.mock('../components/AppRoutes', () => ({
    default: ({ profileName, onProfileRenamed }: { profileName?: string; onProfileRenamed: () => void }) => (
        <div data-testid="app-routes">
            <span data-testid="app-routes-profile">{profileName ?? ''}</span>
            <button type="button" onClick={onProfileRenamed}>{'profile-renamed'}</button>
        </div>
    ),
}));
vi.mock('../pages/MovieDetailPage', () => ({
    default: () => <div data-testid="movie-detail">MovieDetail</div>,
}));
vi.mock('../pages/SeriesDetailPage', () => ({
    default: () => <div data-testid="series-detail">SeriesDetail</div>,
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import App from '../App';
import { dispatchBack } from '../hooks/useBackHandler';
import { setTvMode } from '../utils/platform';

// ============================================================================
// HELPERS
// ============================================================================

/** Rend App et attend le fetch profils (useEffect async) */
async function renderAndWaitForProfiles() {
    let result: ReturnType<typeof render>;
    await act(async () => {
        result = render(<App />);
    });
    await waitFor(() => {
        expect(mockEnsureDefaultProfile).toHaveBeenCalled();
    });
    return result!;
}

/** Rend App → attend profils → clic profil → profileSelected=true */
async function renderAndSelectProfile() {
    const result = await renderAndWaitForProfiles();

    // Le profil "Profile 1" a l'initiale "P" dans un <span>
    // Le bouton est le parent <button class="profile-card">
    const profileButton = screen.getByText('Profile 1').closest('button');
    expect(profileButton).not.toBeNull();

    await act(async () => {
        fireEvent.click(profileButton!);
    });

    return result;
}

// ============================================================================
// TESTS
// ============================================================================

describe('App', () => {
    afterEach(() => {
        Object.assign(mockSessionValues, {
            isLoggedIn: false,
            isLoading: false,
            isLoadingSavedData: false,
            hasSavedSession: false,
            isCheckingSavedSession: false,
            lightIndexes: null,
            credentials: null,
            accountInfo: null,
            activeProfileId: null,
            sourceChanged: false,
            sessionError: null,
        });
        mockSupabaseSignOut.mockReset();
        mockSessionValues.logout.mockReset();
        mockSessionValues.selectProfile.mockClear();
        mockSessionValues.startFresh.mockClear();
        mockEnsureDefaultProfile.mockClear();
        mockSetActiveProfileSupabase.mockClear();
        mockSessionValues.resumeSession.mockReset();
    });

    // ============================
    // Montage
    // ============================
    it('se monte sans crash', () => {
        const { container } = render(<App />);
        expect(container).toBeInTheDocument();
    });

    // ============================
    // Profile Selector (Phase 1.5)
    // ============================
    it('affiche le ProfileSelector après fetch profils', async () => {
        await renderAndWaitForProfiles();
        expect(mockEnsureDefaultProfile).toHaveBeenCalledWith('test-user-id');
        expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
    });

    it('n\'affiche PAS Login ni Sidebar sur le ProfileSelector', async () => {
        await renderAndWaitForProfiles();
        expect(screen.queryByTestId('login-component')).not.toBeInTheDocument();
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('affiche le Login Xtream après sélection profil (sans session sauvegardée)', async () => {
        await renderAndSelectProfile();
        // profileSelected=true, hasSavedSession=false, isLoggedIn=false → Login
        await waitFor(() => {
            expect(screen.getByTestId('login-component')).toBeInTheDocument();
        });
        expect(screen.queryByText('profile_who_watching')).not.toBeInTheDocument();
    });

    it('appelle selectProfile sans écrire dans le cloud quand le profil est déjà actif', async () => {
        await renderAndSelectProfile();
        expect(mockSetActiveProfileSupabase).not.toHaveBeenCalled();
        expect(mockSessionValues.selectProfile).toHaveBeenCalledWith('profile-1');
    });

    it('marque le profil actif dans le cloud quand il ne l\'est pas encore', async () => {
        mockEnsureDefaultProfile.mockResolvedValueOnce([{ ...TEST_PROFILE, is_active: false }]);
        await renderAndSelectProfile();
        expect(mockSetActiveProfileSupabase).toHaveBeenCalledWith('test-user-id', 'profile-1');
        expect(mockSessionValues.selectProfile).toHaveBeenCalledWith('profile-1');
    });

    // Test supprimé : le bouton "Nouvelle connexion" (profile_new_connection)
    // a été retiré de ProfileSelectorPage. La fonction startFresh() reste
    // couverte par SessionContext.test.tsx.

    // ============================
    // Chargement données sauvegardées
    // ============================
    it('affiche l\'écran de chargement quand isLoadingSavedData = true', () => {
        Object.assign(mockSessionValues, { isLoadingSavedData: true });
        const { container } = render(<App />);
        expect(container.querySelector('.loading-screen')).toBeInTheDocument();
        expect(screen.queryByTestId('login-component')).not.toBeInTheDocument();
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('TV : l\'écran de chargement ne garde le focus sur aucun élément (mini carré de focus)', () => {
        setTvMode(true);
        try {
            Object.assign(mockSessionValues, { isLoadingSavedData: true });
            render(<App />);
            expect(document.activeElement).toBe(document.body);
        } finally {
            setTvMode(false);
        }
    });

    // ============================
    // Logout Supabase (isLoggedIn=true — main app)
    // ============================
    /** Profil choisi puis session IPTV ouverte : application principale avec la barre latérale */
    async function renderMainApp() {
        const result = await renderAndSelectProfile();
        Object.assign(mockSessionValues, { isLoggedIn: true });
        await act(async () => {
            result.rerender(<App />);
        });
        await waitFor(() => {
            expect(screen.getByTestId('sidebar')).toBeInTheDocument();
        });
        return result;
    }

    describe('Retour depuis un onglet autre que l\'accueil', () => {
        afterEach(() => {
            mockNavigation.activeTab = 'dashboard';
            mockNavigation.setActiveTab.mockClear();
            setTvMode(false);
        });

        it('bureau et téléphone : revient à l\'accueil', async () => {
            mockNavigation.activeTab = 'settings';
            await renderMainApp();
            let handled = false;
            await act(async () => { handled = dispatchBack(); });
            expect(handled).toBe(true);
            expect(mockNavigation.setActiveTab).toHaveBeenCalledWith('dashboard');
        });

        it('TV : ne change pas d\'onglet, la pile laisse le Retour à la barre latérale', async () => {
            setTvMode(true);
            mockNavigation.activeTab = 'settings';
            await renderMainApp();
            // L'ouverture de l'app pose déjà l'onglet de départ : seul compte ce que fait le Retour
            mockNavigation.setActiveTab.mockClear();
            await act(async () => { dispatchBack(); });
            expect(mockNavigation.setActiveTab).not.toHaveBeenCalled();
        });
    });

    it('déconnexion : fenêtre de l\'app (pas de confirm() système) puis sessionLogout ET signOut', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm');
        await renderMainApp();

        await act(async () => {
            fireEvent.click(screen.getByText('sidebar-logout'));
        });
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(screen.getByText('common:logout_confirm')).toBeInTheDocument();
        expect(mockSessionValues.logout).not.toHaveBeenCalled();

        // Bouton de confirmation : libellé « Déconnexion » (le titre porte le même texte)
        const confirmButton = screen.getAllByText('navigation:logout')
            .map((el) => el.closest('button'))
            .find((btn): btn is HTMLButtonElement => btn !== null);
        await act(async () => {
            fireEvent.click(confirmButton!);
        });
        await waitFor(() => {
            expect(mockSupabaseSignOut).toHaveBeenCalled();
            expect(mockSessionValues.logout).toHaveBeenCalled();
        });
        confirmSpy.mockRestore();
    });

    it('déconnexion annulée : rien n\'est fait', async () => {
        await renderMainApp();

        await act(async () => {
            fireEvent.click(screen.getByText('sidebar-logout'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('common:cancel'));
        });
        expect(screen.queryByText('common:logout_confirm')).not.toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();
        expect(mockSessionValues.logout).not.toHaveBeenCalled();
    });

    // ============================
    // Profils et déconnexion (garde-fous du découpage d'App.tsx)
    // ============================
    /** Bouton de confirmation de la fenêtre de déconnexion (le titre porte le même texte) */
    function logoutConfirmButton(): HTMLButtonElement {
        return screen.getAllByText('navigation:logout')
            .map((el) => el.closest('button'))
            .find((btn): btn is HTMLButtonElement => btn !== null)!;
    }

    it('écran des profils : « Se déconnecter » demande confirmation avant de déconnecter', async () => {
        await renderAndWaitForProfiles();

        await act(async () => {
            fireEvent.click(screen.getByText('profile_sign_out'));
        });
        expect(screen.getByText('common:logout_confirm')).toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();
        expect(mockSessionValues.logout).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(logoutConfirmButton());
        });
        await waitFor(() => {
            expect(mockSupabaseSignOut).toHaveBeenCalled();
            expect(mockSessionValues.logout).toHaveBeenCalled();
        });
    });

    it('écran des profils : déconnexion annulée, on reste sur les profils', async () => {
        await renderAndWaitForProfiles();

        await act(async () => {
            fireEvent.click(screen.getByText('profile_sign_out'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('common:cancel'));
        });
        expect(screen.queryByText('common:logout_confirm')).not.toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();
        expect(mockSessionValues.logout).not.toHaveBeenCalled();
        expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
    });

    it('écran des profils : Retour ferme la fenêtre de déconnexion sans quitter l\'app', async () => {
        await renderAndWaitForProfiles();
        await act(async () => {
            fireEvent.click(screen.getByText('profile_sign_out'));
        });

        let handled = false;
        await act(async () => {
            handled = dispatchBack();
        });
        expect(handled).toBe(true);
        expect(screen.queryByText('common:logout_confirm')).not.toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();
        expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
    });

    it('après la déconnexion depuis l\'app : retour à l\'écran des profils, rechargés', async () => {
        await renderMainApp();
        mockSessionValues.logout.mockImplementation(async () => {
            Object.assign(mockSessionValues, { isLoggedIn: false });
        });
        mockEnsureDefaultProfile.mockClear();

        await act(async () => {
            fireEvent.click(screen.getByText('sidebar-logout'));
        });
        await act(async () => {
            fireEvent.click(logoutConfirmButton());
        });
        await waitFor(() => {
            expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
        });
        expect(mockEnsureDefaultProfile).toHaveBeenCalledWith('test-user-id');
        expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    });

    it('erreur réseau sur les profils : écran d\'erreur, puis « Réessayer » recharge', async () => {
        mockEnsureDefaultProfile.mockRejectedValueOnce(new Error('network down'));
        await renderAndWaitForProfiles();
        await waitFor(() => {
            expect(screen.getByText('common:profile_error_network')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('common:profile_retry'));
        });
        await waitFor(() => {
            expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
        });
        expect(mockEnsureDefaultProfile).toHaveBeenCalledTimes(2);
    });

    it('erreur persistante sur les profils : « Se déconnecter » demande confirmation puis déconnecte', async () => {
        mockEnsureDefaultProfile.mockRejectedValueOnce(new Error('JWT expired'));
        await renderAndWaitForProfiles();
        await waitFor(() => {
            expect(screen.getByText('common:profile_error_network')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('common:profile_sign_out'));
        });
        expect(screen.getByText('common:logout_confirm')).toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(logoutConfirmButton());
        });
        await waitFor(() => {
            expect(mockSupabaseSignOut).toHaveBeenCalled();
            expect(mockSessionValues.logout).toHaveBeenCalled();
        });
        // L'erreur est oubliée : la session suivante recharge les profils au lieu de rester bloquée
        await waitFor(() => {
            expect(screen.queryByText('common:profile_error_network')).not.toBeInTheDocument();
        });
        expect(screen.queryByText('common:profile_retry')).not.toBeInTheDocument();
    });

    it('erreur sur les profils : déconnexion annulée, l\'écran d\'erreur reste', async () => {
        mockEnsureDefaultProfile.mockRejectedValueOnce(new Error('JWT expired'));
        await renderAndWaitForProfiles();
        await waitFor(() => {
            expect(screen.getByText('common:profile_error_network')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('common:profile_sign_out'));
        });
        await act(async () => {
            fireEvent.click(screen.getByText('common:cancel'));
        });
        expect(screen.queryByText('common:logout_confirm')).not.toBeInTheDocument();
        expect(mockSupabaseSignOut).not.toHaveBeenCalled();
        expect(screen.getByText('common:profile_error_network')).toBeInTheDocument();
        expect(screen.getByText('common:profile_retry')).toBeInTheDocument();
    });

    it('profils non cliquables tant que la session sauvegardée est en vérification (formulaire du fournisseur vide sinon)', async () => {
        Object.assign(mockSessionValues, { isCheckingSavedSession: true });
        const { rerender } = await renderAndWaitForProfiles();
        await waitFor(() => {
            expect(screen.getByText('common:profile_loading')).toBeInTheDocument();
        });
        expect(screen.queryByText('Profile 1')).not.toBeInTheDocument();

        // Vérification finie : session trouvée, les profils s'affichent et le choix reprend la session
        Object.assign(mockSessionValues, { isCheckingSavedSession: false, hasSavedSession: true });
        rerender(<App />);
        const profileButton = screen.getByText('Profile 1').closest('button');
        await act(async () => {
            fireEvent.click(profileButton!);
        });
        expect(mockSessionValues.resumeSession).toHaveBeenCalled();
    });

    it('session sauvegardée : le choix du profil relance la session', async () => {
        Object.assign(mockSessionValues, { hasSavedSession: true });
        await renderAndSelectProfile();
        expect(mockSessionValues.selectProfile).toHaveBeenCalledWith('profile-1');
        expect(mockSessionValues.resumeSession).toHaveBeenCalled();
    });

    it('le nom du profil choisi arrive aux pages, et suit un renommage', async () => {
        await renderMainApp();
        expect(screen.getByTestId('app-routes-profile')).toHaveTextContent('Profile 1');

        mockEnsureDefaultProfile.mockResolvedValueOnce([{ ...TEST_PROFILE, display_name: 'Salon' }]);
        await act(async () => {
            fireEvent.click(screen.getByText('profile-renamed'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('app-routes-profile')).toHaveTextContent('Salon');
        });
    });

    it('Retour sur l\'ajout du fournisseur : revient à l\'écran des profils', async () => {
        await renderAndSelectProfile();
        await waitFor(() => {
            expect(screen.getByTestId('login-component')).toBeInTheDocument();
        });

        let handled = false;
        await act(async () => {
            handled = dispatchBack();
        });
        expect(handled).toBe(true);
        await waitFor(() => {
            expect(screen.getByText('profile_who_watching')).toBeInTheDocument();
        });
    });

    it('Retour sur l\'écran des profils : laissé au système (sortie de l\'app)', async () => {
        await renderAndWaitForProfiles();
        let handled = true;
        await act(async () => {
            handled = dispatchBack();
        });
        expect(handled).toBe(false);
    });
});

describe('App — bandeau « source changée »', () => {
    afterEach(() => {
        mockSessionValues.sourceChanged = false;
    });

    // Régression : le bandeau passait à « affiché » et rien ne le remettait à zéro ; après une
    // déconnexion, il revenait à tort sur l'écran d'ajout du fournisseur jusqu'au redémarrage de l'app.
    it('disparaît quand la session ne signale plus de changement de source (déconnexion)', async () => {
        mockSessionValues.sourceChanged = true;
        const { rerender } = await renderAndSelectProfile();
        await waitFor(() => {
            expect(screen.getByText('common:profile_source_changed_warning')).toBeInTheDocument();
        });
        mockSessionValues.sourceChanged = false;
        await act(async () => { rerender(<App />); });
        expect(screen.queryByText('common:profile_source_changed_warning')).toBeNull();
    });
});
