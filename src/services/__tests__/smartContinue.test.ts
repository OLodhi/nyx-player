/**
 * Tests pour smartContinue.ts
 *
 * Vérifient la logique getContinueWatching :
 * - Filtrage par progression (2%-95% pour les films)
 * - Smart Continue (épisode terminé → affiche le suivant)
 * - Déduplication par series_id, tmdb_id, et titre
 * - Ghost card fix (tmdb_id = 0 ne crée pas de doublon)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock SQLite
// ============================================================================

const mockDb = {
  select: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  execute: vi.fn(() => Promise.resolve()),
};

vi.mock('../nyxDatabase', () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Phase 2 Multi-User: débloquer la garde dbName dans getDatabase()
import { setDatabaseName } from '../dbCore';
// Import statique, pas `await import()` dans chaque test : le premier chargement de ce module
// (tmdbApi, client Supabase…) prenait 0,3 s seul et dépassait le délai de 5 s du premier test
// quand toute la suite tournait en parallèle (CI sur le PC). Chargé ici, il compte dans la
// préparation du fichier, qui n'a pas ce délai. Le faux `nyxDatabase` ci-dessus est remonté par
// Vitest avant les imports, il s'applique donc toujours.
import { getContinueWatching } from '../smartContinue';
setDatabaseName('test-uid');

// ============================================================================
// Helper : fabrique de rows
// ============================================================================

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    content_type: 'movie',
    stream_id: 100,
    tmdb_id: 500,
    title: 'Test Movie',
    poster_url: 'http://poster.jpg',
    series_id: null,
    season_number: null,
    episode_number: null,
    next_episode_id: null,
    next_season: null,
    next_episode_number: null,
    time_seconds: 600,
    duration_seconds: 6000, // 10% progress
    container_extension: 'mkv',
    updated_at: Date.now() / 1000,
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('smartContinue — getContinueWatching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exporte getContinueWatching et PlaybackProgressItem', async () => {
    expect(typeof getContinueWatching).toBe('function');
  });

  it('retourne [] quand la base est vide', async () => {
    mockDb.select.mockResolvedValueOnce([]);
    const result = await getContinueWatching();
    expect(result).toEqual([]);
  });

  it('inclut un film avec progression 10% (2-95%)', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({ time_seconds: 600, duration_seconds: 6000 }), // 10%
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('movie');
    expect(result[0].progress).toBe(10);
  });

  it('exclut un film terminé (>95%)', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({ time_seconds: 5800, duration_seconds: 6000 }), // 96.7%
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(0);
  });

  it('exclut un film à peine commencé (<2%)', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({ time_seconds: 10, duration_seconds: 6000 }), // 0.17%
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(0);
  });

  it('Smart Continue: épisode terminé avec next_episode_id → inclus avec progress=0', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({
        content_type: 'episode',
        stream_id: 200,
        series_id: 50,
        season_number: 1,
        episode_number: 3,
        time_seconds: 2900,
        duration_seconds: 3000, // 96.7%
        next_episode_id: '201',
        next_season: 1,
        next_episode_number: 4,
      }),
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(201); // Next episode stream_id
    expect(result[0].progress).toBe(0);
    expect(result[0].episodeInfo?.isNextEpisode).toBe(true);
    expect(result[0].episodeInfo?.episodeNumber).toBe(4);
  });

  it('déduplication par series_id (deux épisodes même série → 1 item)', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({
        content_type: 'episode',
        stream_id: 200,
        series_id: 50,
        tmdb_id: 999,
        title: 'Breaking Bad S01E05',
        time_seconds: 1500,
        duration_seconds: 3000, // 50%
      }),
      makeRow({
        content_type: 'episode',
        stream_id: 199,
        series_id: 50,
        tmdb_id: 999,
        title: 'Breaking Bad S01E04',
        time_seconds: 1000,
        duration_seconds: 3000,
      }),
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(200); // Le plus récent (premier dans ORDER BY)
  });

  it('ghost card fix: tmdb_id=0 ne crée pas de doublon', async () => {
    mockDb.select.mockResolvedValueOnce([
      makeRow({
        content_type: 'episode',
        stream_id: 200,
        series_id: 50,
        tmdb_id: 999,
        title: 'Breaking Bad S01E05',
        time_seconds: 1500,
        duration_seconds: 3000,
      }),
      makeRow({
        content_type: 'episode',
        stream_id: 201,
        series_id: 50,
        tmdb_id: 0, // Ghost card scenario: tmdb_id not propagated
        title: 'Breaking Bad S01E06',
        time_seconds: 500,
        duration_seconds: 3000,
      }),
    ]);
    const result = await getContinueWatching();
    expect(result).toHaveLength(1); // Pas de ghost card!
  });

  it('limite à 30 items max', async () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      makeRow({
        stream_id: 100 + i,
        tmdb_id: 500 + i,
        title: `Movie ${i}`,
      })
    );
    mockDb.select.mockResolvedValueOnce(rows);
    const result = await getContinueWatching();
    expect(result.length).toBeLessThanOrEqual(30);
  });

  // Le titre officiel de la fiche TMDB en cache passe avant le titre
  // enregistré (nom brut du fournisseur possible), le titre enregistré ne sert qu'en secours
  describe('titre officiel TMDB', () => {
    it('lit la fiche TMDB en cache de chaque reprise (celle de la série pour un épisode)', async () => {
      mockDb.select.mockResolvedValueOnce([]);
      await getContinueWatching();
      const calls = mockDb.select.mock.calls as unknown as unknown[][];
      const sql = String(calls[calls.length - 1][0]).replace(/\s+/g, ' ');
      expect(sql).toContain('LEFT JOIN tmdb_details_cache t');
      expect(sql).toContain("t.type = CASE WHEN p.content_type = 'movie' THEN 'movie' ELSE 'series' END");
      expect(sql).toContain('t.season_number = 0');
      expect(sql).toContain('ORDER BY p.updated_at DESC');
    });

    it('titre et affiche de la fiche TMDB à la place du nom brut enregistré', async () => {
      mockDb.select.mockResolvedValueOnce([
        makeRow({ title: 'FR| Le.Titre.2020.1080p', poster_url: 'http://fournisseur/cover.jpg', tmdb_title: 'Le Titre TMDB', tmdb_poster_path: '/affiche.jpg' }),
      ]);
      const [item] = await getContinueWatching();
      expect(item.title).toBe('Le Titre TMDB');
      expect(item.image).toBe('https://image.tmdb.org/t/p/w342/affiche.jpg');
    });

    it('sans fiche en cache : titre et affiche enregistrés', async () => {
      mockDb.select.mockResolvedValueOnce([
        makeRow({ title: 'FR| Le.Titre.2020.1080p', poster_url: 'http://fournisseur/cover.jpg', tmdb_title: null, tmdb_poster_path: null }),
      ]);
      const [item] = await getContinueWatching();
      expect(item.title).toBe('FR| Le.Titre.2020.1080p');
      expect(item.image).toBe('http://fournisseur/cover.jpg');
    });

    it('fiche sans affiche : affiche enregistrée gardée', async () => {
      mockDb.select.mockResolvedValueOnce([
        makeRow({ title: 'Nom brut', poster_url: 'http://poster.jpg', tmdb_title: 'Le Titre TMDB', tmdb_poster_path: null }),
      ]);
      const [item] = await getContinueWatching();
      expect(item.title).toBe('Le Titre TMDB');
      expect(item.image).toBe('http://poster.jpg');
    });

    it('épisode : nom officiel de la série', async () => {
      mockDb.select.mockResolvedValueOnce([
        makeRow({ content_type: 'episode', stream_id: 201, series_id: 50, tmdb_id: 1396, title: 'FR| Breaking.Bad.S01E02', season_number: 1, episode_number: 2, tmdb_title: 'Breaking Bad', tmdb_poster_path: null }),
      ]);
      const [item] = await getContinueWatching();
      expect(item.title).toBe('Breaking Bad');
      expect(item.episodeInfo).toMatchObject({ seasonNumber: 1, episodeNumber: 2 });
    });
  });
});
