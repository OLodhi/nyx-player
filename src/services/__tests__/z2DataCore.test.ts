/**
 * Tests de validation du split Z2 Data Core
 *
 * Vérifient que les modules créés lors du split de sqlite.ts
 * exportent bien les bonnes fonctions et types, et que les
 * dépendances internes sont correctement câblées.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock de la couche Tauri SQL (pas de vraie DB en test)
// ============================================================================

const mockDb = {
  select: vi.fn((_sql?: unknown): Promise<unknown[]> => Promise.resolve([])),
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
// TESTS : dbCore.ts
// ============================================================================

describe('dbCore — Singleton + Meta + Utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exporte getDatabase, getMeta, setMeta, clearAllData, hasContent', async () => {
    const mod = await import('../dbCore');
    expect(typeof mod.getDatabase).toBe('function');
    expect(typeof mod.getMeta).toBe('function');
    expect(typeof mod.setMeta).toBe('function');
    expect(typeof mod.clearAllData).toBe('function');
    expect(typeof mod.hasContent).toBe('function');
    expect(typeof mod.resetDatabaseSingleton).toBe('function');
  });

  it('getMeta retourne null si aucune valeur', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const { getMeta } = await import('../dbCore');
    const result = await getMeta('test-key');
    expect(result).toBeNull();
  });

  it('getMeta retourne la valeur si elle existe', async () => {
    mockDb.select.mockResolvedValueOnce([{ value: 'hello' }]);
    const { getMeta } = await import('../dbCore');
    const result = await getMeta('test-key');
    expect(result).toBe('hello');
  });

  it('hasContent retourne false quand count = 0', async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 0 }]);
    const { hasContent } = await import('../dbCore');
    const result = await hasContent();
    expect(result).toBe(false);
  });

  it('hasContent retourne true quand count > 0', async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 42 }]);
    const { hasContent } = await import('../dbCore');
    const result = await hasContent();
    expect(result).toBe(true);
  });

  // Bug corrigé : un fournisseur « chaînes seulement » (ou « séries seulement ») était pris pour une base
  // vide, la session n'était pas reprise et les identifiants redemandés à chaque lancement
  describe('hasContent compte chaînes, films et séries', () => {
    /** Fausse base : la requête ne voit que les tables qu'elle nomme */
    function catalog(rows: Record<'live' | 'movies' | 'series', number>) {
      mockDb.select.mockImplementationOnce((sql?: unknown) => {
        const query = String(sql);
        const seen = (Object.keys(rows) as (keyof typeof rows)[])
          .filter((table) => new RegExp(`FROM ${table}\\b`).test(query))
          .some((table) => rows[table] > 0);
        return Promise.resolve([{ count: seen ? 1 : 0 }]);
      });
    }

    it('fournisseur avec des chaînes seulement : du contenu', async () => {
      catalog({ live: 120, movies: 0, series: 0 });
      const { hasContent } = await import('../dbCore');
      expect(await hasContent()).toBe(true);
    });

    it('fournisseur avec des séries seulement : du contenu', async () => {
      catalog({ live: 0, movies: 0, series: 30 });
      const { hasContent } = await import('../dbCore');
      expect(await hasContent()).toBe(true);
    });

    it('base vide (connexion interrompue, catalogue vidé) : pas de contenu', async () => {
      catalog({ live: 0, movies: 0, series: 0 });
      const { hasContent } = await import('../dbCore');
      expect(await hasContent()).toBe(false);
    });
  });
});

// ============================================================================
// TESTS : movieRepository.ts — Mapper
// ============================================================================

describe('movieRepository — toIptvStream mapper', () => {
  it('convertit un MovieRow en IptvStream correctement', async () => {
    const { toIptvStream } = await import('../movieRepository');

    const row = {
      id: 123,
      tmdb_id: 456,
      name: 'Test Movie',
      icon: 'http://icon.jpg',
      category_id: '5',
      added: 1700000000,
      rating: 7.5,
      container_extension: 'mkv',
      data: null,
      sort_order: 0,
    };

    const result = toIptvStream(row);

    expect(result.stream_id).toBe(123);
    expect(result.name).toBe('Test Movie');
    expect(result.stream_type).toBe('movie');
    expect(result.tmdb).toBe(456);
    expect(result.stream_icon).toBe('http://icon.jpg');
    expect(result.container_extension).toBe('mkv');
    expect(result.category_id).toBe('5');
  });

  it('gère les valeurs null dans MovieRow', async () => {
    const { toIptvStream } = await import('../movieRepository');

    const row = {
      id: 1,
      tmdb_id: null,
      name: 'Minimal',
      icon: null,
      category_id: null,
      added: null,
      rating: null,
      container_extension: null,
      data: null,
      sort_order: 0,
    };

    const result = toIptvStream(row);

    expect(result.stream_id).toBe(1);
    expect(result.tmdb).toBe(0); // null → 0
    expect(result.stream_icon).toBe(''); // null → ''
    expect(result.category_id).toBe(''); // null → ''
    expect(result.container_extension).toBeUndefined(); // null → undefined
  });
});

// ============================================================================
// TESTS : seriesRepository.ts — Mapper
// ============================================================================

describe('seriesRepository — toIptvSeries mapper', () => {
  it('convertit un SeriesRow en IptvSeries correctement', async () => {
    const { toIptvSeries } = await import('../seriesRepository');

    const row = {
      id: 789,
      tmdb_id: 101,
      name: 'Test Series',
      icon: 'http://cover.jpg',
      category_id: '10',
      added: 1700000000,
      rating: 8.2,
      data: null,
      sort_order: 0,
    };

    const result = toIptvSeries(row);

    expect(result.series_id).toBe(789);
    expect(result.name).toBe('Test Series');
    expect(result.tmdb).toBe(101);
    expect(result.cover).toBe('http://cover.jpg');
    expect(result.category_id).toBe('10');
  });

  it('gère les valeurs null dans SeriesRow', async () => {
    const { toIptvSeries } = await import('../seriesRepository');

    const row = {
      id: 1,
      tmdb_id: null,
      name: 'Minimal',
      icon: null,
      category_id: null,
      added: null,
      rating: null,
      data: null,
      sort_order: 0,
    };

    const result = toIptvSeries(row);

    expect(result.tmdb).toBe(0);
    expect(result.cover).toBe('');
    expect(result.category_id).toBe('');
  });
});

// ============================================================================
// TESTS : Exports existence (smoke tests)
// ============================================================================

describe('Modules Z2 — Smoke tests exports', () => {
  it('dbCore exporte getDatabase, setMeta, getMeta, clearAllData, hasContent', async () => {
    const mod = await import('../dbCore');
    expect(typeof mod.getDatabase).toBe('function');
    expect(typeof mod.getMeta).toBe('function');
    expect(typeof mod.setMeta).toBe('function');
    expect(typeof mod.clearAllData).toBe('function');
    expect(typeof mod.hasContent).toBe('function');
    expect(typeof mod.resetDatabaseSingleton).toBe('function');
  });

  it('movieRepository exporte toIptvStream, getAllMovies, getMovieById', async () => {
    const mod = await import('../movieRepository');
    expect(typeof mod.getAllMovies).toBe('function');
    expect(typeof mod.getMovieById).toBe('function');
    expect(typeof mod.toIptvStream).toBe('function');
  });

  it('seriesRepository exporte toIptvSeries, getAllSeries, getSeriesById', async () => {
    const mod = await import('../seriesRepository');
    expect(typeof mod.getAllSeries).toBe('function');
    expect(typeof mod.getSeriesById).toBe('function');
    expect(typeof mod.toIptvSeries).toBe('function');
  });

  it('liveRepository exporte getAllLive', async () => {
    const mod = await import('../liveRepository');
    expect(typeof mod.getAllLive).toBe('function');
  });

  it('categoryRepository exporte getAllCategories', async () => {
    const mod = await import('../categoryRepository');
    expect(typeof mod.getAllCategories).toBe('function');
  });

  it('searchIndex exporte rebuildSearchIndex, searchContent', async () => {
    const mod = await import('../searchIndex');
    expect(typeof mod.rebuildSearchIndex).toBe('function');
    expect(typeof mod.searchContent).toBe('function');
  });

  it('detailFetcher exporte getMovieDetail, getSeriesDetail, clearDetailCache', async () => {
    const mod = await import('../detailFetcher');
    expect(typeof mod.getMovieDetail).toBe('function');
    expect(typeof mod.getSeriesDetail).toBe('function');
    expect(typeof mod.clearDetailCache).toBe('function');
    expect(typeof mod.getDetailCacheStats).toBe('function');
  });
});



// ============================================================================
// TESTS : searchIndex.ts — searchContent edge cases
// ============================================================================

describe('searchIndex — searchContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retourne [] pour une query vide', async () => {
    const { searchContent } = await import('../searchIndex');
    expect(await searchContent('')).toEqual([]);
    expect(await searchContent('  ')).toEqual([]);
  });

  it('retourne [] pour une query de 1 caractère', async () => {
    const { searchContent } = await import('../searchIndex');
    expect(await searchContent('a')).toEqual([]);
  });
});

// ============================================================================
// TESTS : detailFetcher.ts — Cache LRU
// ============================================================================

describe('detailFetcher — Cache LRU', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clearDetailCache vide le cache', async () => {
    const { clearDetailCache, getDetailCacheStats } = await import('../detailFetcher');
    clearDetailCache();
    const stats = getDetailCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(50);
  });
});
