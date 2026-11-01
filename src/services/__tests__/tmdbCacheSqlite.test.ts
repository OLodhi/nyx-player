/**
 * Tests pour tmdbCacheSqlite.ts — Cache TMDB LRU
 *
 * Vérifie :
 * - getCachedDetails retourne les données sans check TTL
 * - getCachedDetails touche cached_at à la lecture (LRU), au plus une fois par jour
 * - getCachedDetails retourne null si pas en cache
 * - cacheMovieDetails appelle db.execute avec les bons params
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock SQLite
// ============================================================================

const mockDb = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux objet de base : lignes de forme libre
  select: vi.fn((): Promise<any[]> => Promise.resolve([])),
  execute: vi.fn(() => Promise.resolve()),
};

vi.mock('../nyxDatabase', () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Phase 2 Multi-User: débloquer la garde dbName dans getDatabase()
import { setDatabaseName } from '../dbCore';
setDatabaseName('test-uid');

// ============================================================================
// TESTS
// ============================================================================

describe('tmdbCacheSqlite — getCachedDetails', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Force l'initialisation de la DB (schéma + cleanup) pour consommer les appels execute
    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    mockDb.select.mockResolvedValueOnce([]);
    await getCachedDetails(0, 'movie');
    // Reset après init pour que les tests mesurent uniquement les appels pertinents
    vi.clearAllMocks();
  });

  it('retourne null si pas en cache', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    const result = await getCachedDetails(27205, 'movie');
    expect(result).toBeNull();
    // Pas de UPDATE puisque rien trouvé
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('retourne les données sans check TTL (même si elles seraient "expirées")', async () => {
    const testData = { id: 27205, title: 'Inception', vote_average: 8.3 };
    mockDb.select.mockResolvedValueOnce([
      { full_data: JSON.stringify(testData) },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    const result = await getCachedDetails(27205, 'movie');

    expect(result).toEqual(testData);
  });

  it('touche cached_at à chaque lecture (LRU fire-and-forget)', async () => {
    const testData = { id: 27205, title: 'Inception' };
    mockDb.select.mockResolvedValueOnce([
      { full_data: JSON.stringify(testData) },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    await getCachedDetails(27205, 'movie');

    // Vérifie qu'un UPDATE cached_at a été lancé
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = mockDb.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('UPDATE tmdb_details_cache SET cached_at');
    expect(params[1]).toBe(27205); // tmdb_id
    expect(params[2]).toBe('movie'); // type
    expect(params[3]).toBe(0); // season_number (default)
  });

  it('ne réécrit pas la date si elle a moins d\'un jour (une écriture par ouverture évitée)', async () => {
    const testData = { id: 27205, title: 'Inception' };
    mockDb.select.mockResolvedValueOnce([
      { full_data: JSON.stringify(testData), cached_at: Math.floor(Date.now() / 1000) - 3600 },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    const result = await getCachedDetails(27205, 'movie');

    expect(result).toEqual(testData);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('réécrit la date si elle a plus d\'un jour', async () => {
    mockDb.select.mockResolvedValueOnce([
      { full_data: JSON.stringify({ id: 1 }), cached_at: Math.floor(Date.now() / 1000) - 2 * 86400 },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    await getCachedDetails(1, 'movie');

    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('passe le bon season_number pour les saisons', async () => {
    const testData = { id: 456, season_number: 2, episodes: [] };
    mockDb.select.mockResolvedValueOnce([
      { full_data: JSON.stringify(testData) },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    await getCachedDetails(456, 'season', 2);

    // Vérifie le SELECT avec season_number = 2
    const selectArgs = mockDb.select.mock.calls[0] as unknown as [string, unknown[]];
    expect(selectArgs[1]).toEqual([456, 'season', 2]);

    // Vérifie le UPDATE avec season_number = 2
    const execArgs = mockDb.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(execArgs[1][3]).toBe(2); // season_number
  });

  it('retourne null si full_data est un JSON invalide', async () => {
    mockDb.select.mockResolvedValueOnce([
      { full_data: '{invalid json' },
    ]);

    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    const result = await getCachedDetails(999, 'movie');
    expect(result).toBeNull();
    // Le touch est quand même lancé (avant le parse)
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });
});

describe('tmdbCacheSqlite — cacheMovieDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appelle db.execute avec INSERT OR REPLACE', async () => {
    const { cacheMovieDetails } = await import('../tmdbCacheSqlite');
    await cacheMovieDetails(27205, {
      id: 27205,
      title: 'Inception',
      release_date: '2010-07-16',
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      overview: 'A thief who steals...',
      vote_average: 8.3,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fiche TMDB partielle, suffisante pour ce test
    } as any);

    expect(mockDb.execute).toHaveBeenCalled();
    const [sql] = mockDb.execute.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('INSERT OR REPLACE INTO tmdb_details_cache');
  });
});

describe('tmdbCacheSqlite — ensureCacheLanguage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getCachedDetails } = await import('../tmdbCacheSqlite');
    mockDb.select.mockResolvedValueOnce([]);
    await getCachedDetails(0, 'movie');
    vi.clearAllMocks();
  });

  it('ne vide rien si le cache est déjà dans la bonne langue', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: 'en-US' }]);
    const { ensureCacheLanguage } = await import('../tmdbCacheSqlite');
    expect(await ensureCacheLanguage('en-US')).toBe(false);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('vide le cache rempli dans une autre langue et note la nouvelle', async () => {
    mockDb.select.mockResolvedValueOnce([{ data: 'fr-FR' }]);
    const { ensureCacheLanguage } = await import('../tmdbCacheSqlite');
    expect(await ensureCacheLanguage('en-US')).toBe(true);
    const sqls = (mockDb.execute.mock.calls as unknown as [string, unknown[]?][]).map(c => c[0]);
    expect(sqls).toContain('DELETE FROM cache_lists');
    // Fiches de Ma liste et de « Reprendre » gardées pour l'affichage
    expect(sqls.some(sql => sql.startsWith('DELETE FROM tmdb_details_cache WHERE NOT'))).toBe(true);
    expect(sqls).not.toContain('DELETE FROM tmdb_details_cache');
    expect(sqls).not.toContain('DELETE FROM xtream_series_cache');
    const calls = mockDb.execute.mock.calls as unknown as [string, unknown[]?][];
    const marker = calls[calls.length - 1];
    expect(marker[0]).toContain('INSERT OR REPLACE INTO cache_lists');
    expect(marker[1]).toEqual(['__tmdb_cache_language', 'en-US', expect.any(Number), 0]);
  });

  it('ne vide rien sans langue notée en français (premier lancement après la 0.7.6)', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const { ensureCacheLanguage } = await import('../tmdbCacheSqlite');
    expect(await ensureCacheLanguage('fr-FR')).toBe(false);
    const calls = mockDb.execute.mock.calls as unknown as [string, unknown[]?][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain('INSERT OR REPLACE INTO cache_lists');
    expect(calls[0][1]).toEqual(['__tmdb_cache_language', 'fr-FR', expect.any(Number), 0]);
  });

  it('vide le cache sans langue notée quand la langue n\'est pas le français', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const { ensureCacheLanguage } = await import('../tmdbCacheSqlite');
    expect(await ensureCacheLanguage('en-US')).toBe(true);
    const sqls = (mockDb.execute.mock.calls as unknown as [string, unknown[]?][]).map(c => c[0]);
    expect(sqls).toContain('DELETE FROM cache_lists');
  });
});
