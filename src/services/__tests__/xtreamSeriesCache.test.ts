/**
 * Tests pour xtreamSeriesCache.ts
 *
 * Vérifient le stockage/récupération des séries Xtream (épisodes).
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
// Imports statiques, pas `await import()` dans chaque test : le premier chargement de
// sessionSteps (catalogue, synchro, client Supabase, i18n…) prenait 0,4 à 0,9 s seul et dépassait
// le délai de 5 s du test « changement de fournisseur » quand toute la suite tournait en parallèle (CI sur le PC).
// Chargés ici, ils comptent dans la préparation du fichier, qui n'a pas ce délai. Le faux
// `nyxDatabase` ci-dessus est remonté par Vitest avant les imports, il s'applique donc toujours.
import { getCachedXtreamSeries, setCachedXtreamSeries } from '../xtreamSeriesCache';
import { wipeProviderSpecificData } from '../sessionSteps';
setDatabaseName('test-uid');

// ============================================================================
// TESTS
// ============================================================================

describe('xtreamSeriesCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exporte getCachedXtreamSeries et setCachedXtreamSeries', async () => {
    expect(typeof getCachedXtreamSeries).toBe('function');
    expect(typeof setCachedXtreamSeries).toBe('function');
  });

  it('getCachedXtreamSeries retourne null quand cache vide', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const result = await getCachedXtreamSeries(123);
    expect(result).toBeNull();
  });

  it('getCachedXtreamSeries retourne les données si cache valide', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const testData = { seasons: [{ name: 'S01', episodes: [] }] };
    mockDb.select.mockResolvedValueOnce([
      {
        data: JSON.stringify(testData),
        cached_at: nowSec - 100, // 100s ago
        ttl_seconds: 86400, // 24h TTL
      },
    ]);
    const result = await getCachedXtreamSeries(123);
    expect(result).toEqual(testData);
  });

  it('getCachedXtreamSeries retourne null si cache expiré', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    mockDb.select.mockResolvedValueOnce([
      {
        data: JSON.stringify({ seasons: [] }),
        cached_at: nowSec - 100000, // >24h ago
        ttl_seconds: 86400,
      },
    ]);
    const result = await getCachedXtreamSeries(123);
    expect(result).toBeNull();
  });

  it('setCachedXtreamSeries appelle db.execute', async () => {
    await setCachedXtreamSeries(456, { test: true });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
    // Vérifie que le seriesId est dans les params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- arguments d'appel du faux objet, non typés
    const callArgs = mockDb.execute.mock.calls[0] as any[];
    expect(callArgs[1][0]).toBe(456); // seriesId
  });
});

// Le cache des épisodes (`xtream_series_cache`, rangé par
// numéro de série, 24 h) est vidé au changement de fournisseur. Sans cela, une série qui porte le même
// numéro chez le nouveau fournisseur montrait pendant 24 h les épisodes de l'ancien, illisibles.
describe('xtreamSeriesCache — changement de fournisseur', () => {
  it('les données du fournisseur effacées comprennent le cache des épisodes', async () => {
    mockDb.execute.mockClear();

    await wipeProviderSpecificData();

    const statements = mockDb.execute.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(statements.some((sql) => /DELETE FROM playback_progress/.test(sql))).toBe(true); // effacement bien passé
    expect(statements.some((sql) => /DELETE FROM xtream_series_cache/.test(sql))).toBe(true);
  });

  it('ne touche ni au cache TMDB ni aux listes en cache (fiches protégées de Ma liste et Reprendre)', async () => {
    mockDb.execute.mockClear();

    await wipeProviderSpecificData();

    const statements = mockDb.execute.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(statements.some((sql) => /tmdb_details_cache|cache_lists/.test(sql))).toBe(false);
  });
});
