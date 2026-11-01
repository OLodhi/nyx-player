/**
 * Tests pour SessionContext — Phase 6C3
 *
 * Teste les valeurs initiales, le guard useSession hors provider,
 * la détection de session sauvegardée, et la dérivation d'état (iptvStatus).
 *
 * NOTE: Le flow complet login() n'est PAS testé ici car il chaîne 10+ services
 * async moqués (ingestion, SQLite, indexes) — ce serait un test d'intégration.
 * Les transitions login/logout sont couvertes indirectement via les tests E2E.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';

// ============================================================================
// MOCKS
// ============================================================================

// Mock i18n
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

// Mock StorageService
const mockGetCredentials = vi.fn().mockResolvedValue(null);
const mockHasData = vi.fn().mockResolvedValue(false);

vi.mock('../../services/storage', () => ({
    describeVaultError: (e: unknown) => String(e),
    StorageService: {
        getCredentials: () => mockGetCredentials(),
        getCredentialsAtStartup: () => mockGetCredentials(),
        saveCredentials: vi.fn().mockResolvedValue(undefined),
        hasData: () => mockHasData(),
        clearAll: vi.fn().mockResolvedValue(undefined),
        clearCredentials: vi.fn(),
    },
}));

// Mock XtreamApiService
vi.mock('../../services/xtreamApi', () => ({
    XtreamApiService: vi.fn().mockImplementation(() => ({
        authenticate: vi.fn().mockResolvedValue({
            user_info: { username: 'testuser', status: 'Active' },
        }),
    })),
}));

// Mock all async services used by SessionProvider
vi.mock('../../services/catalogIngestion', () => ({
    ingestCatalog: vi.fn().mockResolvedValue(undefined),
    cancelCatalogIngestion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/movieRepository', () => ({
    getAllMovies: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/seriesRepository', () => ({
    getAllSeries: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/liveRepository', () => ({
    getAllLive: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/categoryRepository', () => ({
    getAllCategories: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../services/dbCore', () => ({
    setMeta: vi.fn().mockResolvedValue(undefined),
    getMeta: vi.fn().mockResolvedValue(null),
    clearAllData: vi.fn().mockResolvedValue(undefined),
    clearCatalogData: vi.fn().mockResolvedValue(undefined),
    isDatabaseOf: vi.fn(() => true),
    refreshConnection: vi.fn().mockResolvedValue(undefined),
    getDatabase: vi.fn().mockResolvedValue({}),
}));
// Phase 2 Multi-User: SessionProvider utilise useSupabaseAuth() pour isDbReady
vi.mock('../SupabaseAuthContext', () => ({
    useSupabaseAuth: () => ({ isDbReady: true }),
}));
vi.mock('../../services/searchIndex', () => ({
    rebuildSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/lightIndexBuilder', () => ({
    buildLightIndexesFromSQLite: vi.fn().mockReturnValue({
        movies: new Map(),
        series: new Map(),
        live: new Map(),
        categories: new Map(),
        moviesByTmdb: new Map(),
        seriesByTmdb: new Map(),
        iconPrefixes: [],
    }),
}));
vi.mock('../../services/preferencesService', () => ({
    initPreferences: vi.fn().mockResolvedValue(undefined),
    getHomePage: vi.fn().mockReturnValue('dashboard'),
    getLanguage: vi.fn().mockReturnValue('en'),
}));
vi.mock('../../services/liveTvBookmarksService', () => ({
    initLiveTvBookmarks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/piconCache', () => ({
    initPiconCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../utils/tmdbLanguage', () => ({ getTmdbLanguage: () => 'en-US' }));
vi.mock('../../services/tmdbCacheSqlite', () => ({
    ensureCacheLanguage: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../services/catalogReconcile', () => ({
    prepareRefreshedCatalog: vi.fn(async (indexes: unknown) => ({ indexes, dashboard: { generation: 0, base: null, genres: null } })),
    applyRefreshedCatalog: vi.fn((prepared: { indexes: unknown }, set: (v: unknown) => void) => set(prepared.indexes)),
    resetCatalogCaches: vi.fn(),
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import { SessionProvider, useSession } from '../SessionContext';

// ============================================================================
// TEST CONSUMER
// ============================================================================

const TestConsumer: React.FC = () => {
    const session = useSession();
    return (
        <div>
            <span data-testid="is-logged-in">{String(session.isLoggedIn)}</span>
            <span data-testid="is-loading">{String(session.isLoading)}</span>
            <span data-testid="has-saved-session">{String(session.hasSavedSession)}</span>
            <span data-testid="checking-saved-session">{String(session.isCheckingSavedSession)}</span>
            <span data-testid="credentials">{session.credentials ? 'set' : 'null'}</span>
            <span data-testid="iptv-status">{session.iptvStatus}</span>
            <span data-testid="has-content-counts">{session.settingsContentCounts ? 'yes' : 'no'}</span>
            <span data-testid="home-tab">{session.homeTab}</span>
            <span data-testid="session-error">{session.sessionError ?? 'null'}</span>
            <button data-testid="btn-logout" onClick={() => void session.logout()}>Logout</button>
            <button data-testid="btn-start-fresh" onClick={() => void session.startFresh()}>StartFresh</button>
        </div>
    );
};

// ============================================================================
// TESTS
// ============================================================================

describe('SessionContext', () => {
    beforeEach(() => {
        mockGetCredentials.mockReset().mockResolvedValue(null);
        mockHasData.mockReset().mockResolvedValue(false);
    });

    it('fournit les valeurs initiales correctes', () => {
        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        expect(screen.getByTestId('is-logged-in')).toHaveTextContent('false');
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        expect(screen.getByTestId('credentials')).toHaveTextContent('null');
        expect(screen.getByTestId('home-tab')).toHaveTextContent('dashboard');
        expect(screen.getByTestId('session-error')).toHaveTextContent('null');
    });

    it('useSession() hors du provider lance une erreur', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => { });
        expect(() => render(<TestConsumer />)).toThrow(
            'useSession must be used within a SessionProvider'
        );
        spy.mockRestore();
    });

    it('détecte une session sauvegardée au démarrage', async () => {
        mockGetCredentials.mockResolvedValue({
            host: 'http://test.com', username: 'user', password: 'pass',
        });
        mockHasData.mockResolvedValue(true);

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('has-saved-session')).toHaveTextContent('true');
        });
    });

    it('reste « en vérification » tant que la session sauvegardée n\'est pas lue (clic de profil trop tôt)', async () => {
        // Coffre Android lent au premier lancement après une mise à jour : la réponse arrive plus tard
        let resolveCreds: (v: unknown) => void = () => {};
        mockGetCredentials.mockReturnValue(new Promise((r) => { resolveCreds = r; }));
        mockHasData.mockResolvedValue(true);

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        expect(screen.getByTestId('checking-saved-session')).toHaveTextContent('true');
        expect(screen.getByTestId('has-saved-session')).toHaveTextContent('false');

        await act(async () => {
            resolveCreds({ host: 'http://test.com', username: 'user', password: 'pass' });
        });

        await waitFor(() => {
            expect(screen.getByTestId('checking-saved-session')).toHaveTextContent('false');
        });
        expect(screen.getByTestId('has-saved-session')).toHaveTextContent('true');
    });

    it('termine la vérification même si la base ne répond pas', async () => {
        mockGetCredentials.mockResolvedValue({ host: 'http://test.com', username: 'user', password: 'pass' });
        mockHasData.mockRejectedValue(new Error('database is locked'));

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('checking-saved-session')).toHaveTextContent('false');
        });
    });

    it('ne détecte PAS de session quand le keychain est vide', async () => {
        mockGetCredentials.mockResolvedValue(null);
        mockHasData.mockResolvedValue(false);

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        // Wait for the useEffect to complete
        await act(async () => {
            await new Promise(r => setTimeout(r, 50));
        });

        expect(screen.getByTestId('has-saved-session')).toHaveTextContent('false');
    });

    it('iptvStatus est ok par défaut (pas de lightIndexes)', () => {
        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        expect(screen.getByTestId('iptv-status')).toHaveTextContent('ok');
    });

    it('settingsContentCounts est undefined quand pas de lightIndexes', () => {
        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        expect(screen.getByTestId('has-content-counts')).toHaveTextContent('no');
    });

    it('logout() ne crash pas sur état initial', async () => {
        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        await act(async () => {
            screen.getByTestId('btn-logout').click();
        });

        expect(screen.getByTestId('is-logged-in')).toHaveTextContent('false');
        expect(screen.getByTestId('credentials')).toHaveTextContent('null');
    });

    it('startFresh() met hasSavedSession à false', async () => {
        mockGetCredentials.mockResolvedValue({
            host: 'http://test.com', username: 'user', password: 'pass',
        });
        mockHasData.mockResolvedValue(true);

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        // Wait for session detection
        await waitFor(() => {
            expect(screen.getByTestId('has-saved-session')).toHaveTextContent('true');
        });

        // Call startFresh
        await act(async () => {
            screen.getByTestId('btn-start-fresh').click();
        });

        expect(screen.getByTestId('has-saved-session')).toHaveTextContent('false');
    });

    it('iptvStatus est ok par défaut même après resumeSession (partial non persisté)', async () => {
        // getMeta retourne null → lastIngestionPartial = false → iptvStatus reste 'ok'
        const { getMeta } = await import('../../services/dbCore');
        (getMeta as ReturnType<typeof vi.fn>).mockResolvedValue(null);

        render(
            <SessionProvider>
                <TestConsumer />
            </SessionProvider>
        );

        expect(screen.getByTestId('iptv-status')).toHaveTextContent('ok');
    });
});
