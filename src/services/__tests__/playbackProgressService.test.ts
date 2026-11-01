/**
 * Tests pour playbackProgressService.ts
 *
 * 15 tests couvrant le CRUD des progressions de lecture :
 * - startPlayback (insert + upsert)
 * - updateProgress
 * - finalizePlayback (< 2%, 50%, > 95%, > 95% + Smart Continue, purge auto)
 * - getProgressByStreamId / getProgressByStreamIds
 * - clearProgress / clearMultipleProgress / clearProgressByType
 * - hasProgress
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock SQLite
// ============================================================================

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
};

vi.mock('../nyxDatabase', () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Phase 2 Multi-User : débloquer la garde dbName dans getDatabase()
import { setDatabaseName } from '../dbCore';
setDatabaseName('test-uid');

// ============================================================================
// Mock syncService (fire-and-forget)
// ============================================================================

vi.mock('../syncService', () => ({
  pushPlaybackUpsertToCloud: vi.fn(),
  pushPlaybackDeleteToCloud: vi.fn(),
}));

import { pushPlaybackUpsertToCloud, pushPlaybackDeleteToCloud } from '../syncService';
import { recordServerTime, resetServerClock } from '../sync/serverClock';

// Dernier accord avec le cloud : un compte connecté, et ce que la synchro sait de chaque reprise
const baselineEntries = new Map<string, number>();
vi.mock('../sync/syncState', () => ({ getCurrentSyncUserId: vi.fn(() => 'user-test') }));
vi.mock('../sync/syncBaseline', () => ({
  readBaseline: vi.fn(async () => new Map(baselineEntries)),
  forgetForCurrentAccount: vi.fn(async () => {}),
}));
import { forgetForCurrentAccount } from '../sync/syncBaseline';

// ============================================================================
// Mock window.dispatchEvent
// ============================================================================

const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);

// ============================================================================
// Import du module sous test
// ============================================================================

import {
  startPlayback,
  updateProgress,
  finalizePlayback,
  getProgressByStreamId,
  getProgressByStreamIds,
  getProgressByTmdbIds,
  clearProgress,
  clearMultipleProgress,
  clearProgressByType,
  clearUnavailableResume,
  hasProgress,
} from '../playbackProgressService';

// ============================================================================
// TESTS
// ============================================================================

describe('playbackProgressService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baselineEntries.clear();
    mockDb.select.mockResolvedValue([]);
    mockDb.execute.mockResolvedValue(undefined);
  });

  // ──────────────────────────────────────────────
  // 1. startPlayback basique
  // ──────────────────────────────────────────────
  it('startPlayback — insert une entrée pending (time=0, duration=0)', async () => {
    await startPlayback({
      streamId: 42,
      contentType: 'movie',
      title: 'Test Movie',
      posterUrl: 'http://poster.jpg',
    });

    // Note: getDatabase() peut faire des appels internes (PRAGMA/init),
    // donc on cherche l'appel INSERT parmi tous les appels
    const insertCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('INSERT INTO playback_progress')
    );
    expect(insertCall).toBeDefined();

    const sql = insertCall![0] as string;
    expect(sql).toContain('ON CONFLICT(stream_id) DO UPDATE');

    const params = insertCall![1] as unknown[];
    // contentType, streamId, tmdbId, title, posterUrl
    expect(params[0]).toBe('movie');
    expect(params[1]).toBe(42);
    expect(params[3]).toBe('Test Movie');
    // time_seconds = 0 (index 11), duration_seconds = 0 (index 12)
    expect(params[11]).toBe(0);
    expect(params[12]).toBe(0);
  });

  // ──────────────────────────────────────────────
  // 2. startPlayback upsert (même streamId → pas de doublon)
  // ──────────────────────────────────────────────
  it('startPlayback upsert — même streamId utilise ON CONFLICT', async () => {
    await startPlayback({
      streamId: 42,
      contentType: 'movie',
      title: 'Movie V1',
    });
    await startPlayback({
      streamId: 42,
      contentType: 'movie',
      title: 'Movie V2',
    });

    // Les deux appels utilisent la même requête ON CONFLICT
    const insertCalls = mockDb.execute.mock.calls.filter(
      (c) => (c[0] as string).includes('INSERT INTO playback_progress')
    );
    expect(insertCalls.length).toBeGreaterThanOrEqual(2);
    expect(insertCalls[0][0] as string).toContain('ON CONFLICT(stream_id) DO UPDATE');
    expect(insertCalls[1][0] as string).toContain('ON CONFLICT(stream_id) DO UPDATE');
  });

  // Seul un titre TMDB remplace le titre enregistré
  const lastUpsert = () => {
    const upserts = mockDb.execute.mock.calls.filter(([sql]) => sql.includes('INSERT INTO playback_progress'));
    const [sql, params] = upserts[upserts.length - 1];
    return { sql: sql.replace(/\s+/g, ' '), params: params as unknown[] };
  };

  it('relancer sans titre TMDB garde le titre TMDB déjà enregistré', async () => {
    await startPlayback({ contentType: 'movie', streamId: 50, tmdbId: 42, title: 'Le Titre TMDB', titleFromTmdb: true });
    await startPlayback({ contentType: 'movie', streamId: 50, tmdbId: 0, title: 'FR| Le.Titre.2020.1080p' });

    const { sql } = lastUpsert();
    expect(sql).not.toMatch(/title = excluded\.title,/);
    expect(sql).toMatch(/title = CASE WHEN playback_progress\.title IN \('', 'Unknown'\) OR .* THEN excluded\.title ELSE playback_progress\.title END,/);
  });

  it('sans titre TMDB, le nom du fournisseur remplace seulement un titre vide ou celui d\'un autre contenu', async () => {
    await startPlayback({ contentType: 'movie', streamId: 50, tmdbId: 7, title: 'FR| Autre.Film.1080p' });

    const { sql } = lastUpsert();
    expect(sql).toContain("playback_progress.title IN ('', 'Unknown')");
    expect(sql).toContain('excluded.content_type <> playback_progress.content_type');
    expect(sql).toContain('(excluded.tmdb_id > 0 AND excluded.tmdb_id <> playback_progress.tmdb_id)');
  });

  it('le nom du fournisseur sert pour une première lecture', async () => {
    await startPlayback({ contentType: 'movie', streamId: 51, title: 'FR| Le.Titre.2020.1080p' });

    // Insertion : le titre passé est enregistré tel quel (aucune ligne existante à garder)
    expect(lastUpsert().params[3]).toBe('FR| Le.Titre.2020.1080p');
  });

  it('lancé depuis la fiche, le titre TMDB remplace le titre enregistré', async () => {
    await startPlayback({ contentType: 'movie', streamId: 52, tmdbId: 42, title: 'Le Titre TMDB', titleFromTmdb: true });

    const { sql, params } = lastUpsert();
    expect(sql).toContain('title = excluded.title,');
    expect(params[3]).toBe('Le Titre TMDB');
  });

  // ──────────────────────────────────────────────
  // 3. updateProgress
  // ──────────────────────────────────────────────
  it('updateProgress — met à jour time_seconds et duration_seconds', async () => {
    await updateProgress(42, 300, 6000);

    const updateCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('UPDATE playback_progress SET time_seconds')
    );
    expect(updateCall).toBeDefined();

    const params = updateCall![1] as unknown[];
    expect(params[0]).toBe(300);   // timeSeconds
    expect(params[1]).toBe(6000);  // durationSeconds
    expect(params[3]).toBe(42);    // streamId (WHERE clause)
  });

  // ──────────────────────────────────────────────
  // 4. finalizePlayback < 2% → DELETE
  // ──────────────────────────────────────────────
  it('finalizePlayback < 2% — supprime l\'entrée (pas vraiment regardé)', async () => {
    await finalizePlayback({
      streamId: 42,
      timeSeconds: 10,
      durationSeconds: 6000, // 0.17%
    });

    const deleteCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('DELETE FROM playback_progress')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0] as string).toContain('stream_id');
  });

  it('finalizePlayback < 2% — un titre qui avait déjà une reprise la retrouve, sans rien envoyer ni effacer', async () => {
    // Reprise d'avant : 40 % d'un film, enregistrée (et envoyée au cloud) à 5000 ms
    mockDb.select.mockResolvedValueOnce([{ time_seconds: 2400, duration_seconds: 6000, updated_at: 5000 }]);
    await startPlayback({ contentType: 'movie', streamId: 43, title: 'Film déjà commencé' });
    // « Recommencer », puis arrêt au bout d'une minute
    await updateProgress(43, 60, 6000);
    mockDb.execute.mockClear();

    await finalizePlayback({ streamId: 43, timeSeconds: 60, durationSeconds: 6000 });

    const calls = mockDb.execute.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('DELETE'))).toBe(false);
    const restore = mockDb.execute.mock.calls.find((c) => (c[0] as string).startsWith('UPDATE playback_progress'));
    expect(restore![1]).toEqual([2400, 6000, 5000, 43]);
    expect(pushPlaybackUpsertToCloud).not.toHaveBeenCalled();
    expect(pushPlaybackDeleteToCloud).not.toHaveBeenCalled();
  });

  it('finalizePlayback < 2% — reprise d\'avant redatée et renvoyée si une synchro a envoyé la position en cours', async () => {
    mockDb.select.mockResolvedValueOnce([{ time_seconds: 2400, duration_seconds: 6000, updated_at: 5000 }]);
    await startPlayback({ contentType: 'movie', streamId: 46, title: 'Film' });
    // Une synchro pendant la lecture a envoyé « 60 s » datée de 9000, et le dernier accord le retient
    baselineEntries.set('46', 9000);
    mockDb.execute.mockClear();
    mockDb.select.mockResolvedValueOnce([{ content_type: 'movie', tmdb_id: 0, title: 'Film', poster_url: null, series_id: null, season_number: null, episode_number: null, next_episode_id: null, next_season: null, next_episode_number: null, time_seconds: 2400, duration_seconds: 6000, container_extension: null }]);

    await finalizePlayback({ streamId: 46, timeSeconds: 60, durationSeconds: 6000 });

    const restore = mockDb.execute.mock.calls.find((c) => (c[0] as string).startsWith('UPDATE playback_progress'));
    const [time, duration, updatedAt] = restore![1] as number[];
    expect([time, duration]).toEqual([2400, 6000]);
    expect(updatedAt).toBeGreaterThan(9000);
    expect(pushPlaybackUpsertToCloud).toHaveBeenCalledWith(46, 'movie', expect.objectContaining({ time_seconds: 2400, updated_at: updatedAt }));
  });

  it('finalizePlayback < 2% — la reprise d\'avant ne sert qu\'une fois', async () => {
    mockDb.select.mockResolvedValueOnce([{ time_seconds: 2400, duration_seconds: 6000, updated_at: 5000 }]);
    await startPlayback({ contentType: 'movie', streamId: 44, title: 'Film' });
    await finalizePlayback({ streamId: 44, timeSeconds: 3000, durationSeconds: 6000 }); // 50 %
    mockDb.execute.mockClear();

    await finalizePlayback({ streamId: 44, timeSeconds: 30, durationSeconds: 6000 });

    expect(mockDb.execute.mock.calls.some((c) => (c[0] as string).includes('DELETE FROM playback_progress'))).toBe(true);
  });

  it('finalizePlayback < 2% — une entrée en attente (durée inconnue) n\'est pas une reprise d\'avant', async () => {
    mockDb.select.mockResolvedValueOnce([{ time_seconds: 0, duration_seconds: 0, updated_at: 5000 }]);
    await startPlayback({ contentType: 'movie', streamId: 45, title: 'Film' });
    mockDb.execute.mockClear();

    await finalizePlayback({ streamId: 45, timeSeconds: 20, durationSeconds: 6000 });

    expect(mockDb.execute.mock.calls.some((c) => (c[0] as string).includes('DELETE FROM playback_progress'))).toBe(true);
  });

  // ──────────────────────────────────────────────
  // 5. finalizePlayback 50% → UPDATE, poster conservé
  // ──────────────────────────────────────────────
  it('finalizePlayback 50% — update avec progression, poster conservé', async () => {
    // Mock : SELECT pour le cloud push
    mockDb.select.mockResolvedValueOnce([{
      content_type: 'movie',
      tmdb_id: 500,
      title: 'Test Movie',
      poster_url: 'http://poster.jpg',
      series_id: null,
      season_number: null,
      episode_number: null,
      next_episode_id: null,
      next_season: null,
      next_episode_number: null,
      time_seconds: 3000,
      duration_seconds: 6000,
      container_extension: 'mkv',
    }]);

    await finalizePlayback({
      streamId: 42,
      timeSeconds: 3000,
      durationSeconds: 6000, // 50%
    });

    // Appels attendus : UPDATE progression + DELETE purge (pas de DELETE stream)
    const calls = mockDb.execute.mock.calls;
    const updateCall = calls.find((c) => (c[0] as string).includes('UPDATE playback_progress SET'));
    expect(updateCall).toBeDefined();
    const updateSql = updateCall![0] as string;
    // Pas de poster_url = NULL dans le SQL (poster conservé)
    expect(updateSql).not.toContain('poster_url = NULL');

    // Event dispatché
    expect(dispatchSpy).toHaveBeenCalled();
    // Cloud push appelé
    expect(pushPlaybackUpsertToCloud).toHaveBeenCalled();
  });

  it('finalizePlayback — box en avance de 2 jours : reprise datée à l’heure du serveur, en local et dans le cloud', async () => {
    const serverTime = Date.UTC(2026, 9, 12, 10, 0, 0);
    mockDb.select.mockResolvedValueOnce([{
      content_type: 'movie', tmdb_id: 500, title: 'Test Movie', poster_url: null,
      series_id: null, season_number: null, episode_number: null,
      next_episode_id: null, next_season: null, next_episode_number: null,
      time_seconds: 3000, duration_seconds: 6000, container_extension: 'mkv',
    }]);
    vi.useFakeTimers({ toFake: ['Date'], now: serverTime + 2 * 24 * 60 * 60 * 1000 });
    try {
      recordServerTime(serverTime);
      await finalizePlayback({ streamId: 42, timeSeconds: 3000, durationSeconds: 6000 });
    } finally {
      vi.useRealTimers();
      resetServerClock();
    }

    const update = mockDb.execute.mock.calls.find(([sql]) => sql.includes('UPDATE playback_progress SET'));
    expect(update?.[1]).toContain(serverTime);
    expect(pushPlaybackUpsertToCloud).toHaveBeenCalledWith(42, 'movie', expect.objectContaining({ updated_at: serverTime }));
  });

  // ──────────────────────────────────────────────
  // 6. finalizePlayback > 95% → poster_url = NULL
  // ──────────────────────────────────────────────
  it('finalizePlayback > 95% — poster_url = NULL (économie espace)', async () => {
    mockDb.select.mockResolvedValueOnce([{
      content_type: 'movie',
      tmdb_id: 500,
      title: 'Test Movie',
      poster_url: null,
      series_id: null,
      season_number: null,
      episode_number: null,
      next_episode_id: null,
      next_season: null,
      next_episode_number: null,
      time_seconds: 5800,
      duration_seconds: 6000,
      container_extension: 'mkv',
    }]);

    await finalizePlayback({
      streamId: 42,
      timeSeconds: 5800,
      durationSeconds: 6000, // 96.7%
      nextEpisode: null,
    });

    const calls = mockDb.execute.mock.calls;
    const updateCall = calls.find((c) => (c[0] as string).includes('UPDATE playback_progress SET'));
    expect(updateCall).toBeDefined();
    const updateSql = updateCall![0] as string;
    expect(updateSql).toContain('poster_url = NULL');
  });

  // ──────────────────────────────────────────────
  // 7. finalizePlayback > 95% + Smart Continue → poster conservé
  // ──────────────────────────────────────────────
  it('finalizePlayback > 95% + Smart Continue — poster_url conservé', async () => {
    mockDb.select.mockResolvedValueOnce([{
      content_type: 'episode',
      tmdb_id: 500,
      title: 'Breaking Bad S01E05',
      poster_url: 'http://poster.jpg',
      series_id: 50,
      season_number: 1,
      episode_number: 5,
      next_episode_id: '201',
      next_season: 1,
      next_episode_number: 6,
      time_seconds: 2900,
      duration_seconds: 3000,
      container_extension: 'mkv',
    }]);

    await finalizePlayback({
      streamId: 200,
      timeSeconds: 2900,
      durationSeconds: 3000, // 96.7%
      nextEpisode: {
        episodeId: '201',
        seasonNumber: 1,
        episodeNumber: 6,
      },
    });

    const calls = mockDb.execute.mock.calls;
    const updateCall = calls.find((c) => (c[0] as string).includes('UPDATE playback_progress SET'));
    expect(updateCall).toBeDefined();
    const updateSql = updateCall![0] as string;
    // Poster PAS effacé car Smart Continue actif
    expect(updateSql).not.toContain('poster_url = NULL');
  });

  // ──────────────────────────────────────────────
  // 8. getProgressByStreamId — existant
  // ──────────────────────────────────────────────
  it('getProgressByStreamId — retourne { timeSeconds, durationSeconds, progressPercent }', async () => {
    mockDb.select.mockResolvedValueOnce([
      { time_seconds: 3000, duration_seconds: 6000 },
    ]);

    const result = await getProgressByStreamId(42);

    expect(result).toEqual({
      timeSeconds: 3000,
      durationSeconds: 6000,
      progressPercent: 50,
    });
  });

  // ──────────────────────────────────────────────
  // 9. getProgressByStreamId — inexistant
  // ──────────────────────────────────────────────
  it('getProgressByStreamId — retourne null si inexistant', async () => {
    mockDb.select.mockResolvedValueOnce([]);

    const result = await getProgressByStreamId(999);
    expect(result).toBeNull();
  });

  // ──────────────────────────────────────────────
  // 10. getProgressByStreamIds — batch
  // ──────────────────────────────────────────────
  it('getProgressByStreamIds — retourne Map avec les entrées trouvées', async () => {
    mockDb.select.mockResolvedValueOnce([
      { stream_id: 10, time_seconds: 300, duration_seconds: 3000 },
      { stream_id: 20, time_seconds: 1500, duration_seconds: 3000 },
    ]);

    const result = await getProgressByStreamIds([10, 20, 30]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get(10)).toEqual({
      timeSeconds: 300,
      durationSeconds: 3000,
      progressPercent: 10,
    });
    expect(result.get(20)).toEqual({
      timeSeconds: 1500,
      durationSeconds: 3000,
      progressPercent: 50,
    });
    expect(result.has(30)).toBe(false);
  });

  // ──────────────────────────────────────────────
  // 11. clearProgress — supprime + dispatch event
  // ──────────────────────────────────────────────
  it('clearProgress — supprime l\'entrée et dispatch event', async () => {
    await clearProgress(42);

    const deleteCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('DELETE FROM playback_progress')
    );
    expect(deleteCall).toBeDefined();

    expect(dispatchSpy).toHaveBeenCalled();
    const eventCall = dispatchSpy.mock.calls.find(
      (c) => (c[0] as Event).type === 'playbackPositionUpdated'
    );
    expect(eventCall).toBeDefined();

    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(42);
  });

  // ──────────────────────────────────────────────
  // 12. clearMultipleProgress — vide → ne crash pas
  // ──────────────────────────────────────────────
  it('clearMultipleProgress — ne crash pas sur tableau vide', async () => {
    await clearMultipleProgress([]);

    // Aucun appel DB
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 13. clearProgressByType — filtre par content_type
  // ──────────────────────────────────────────────
  it('clearProgressByType — filtre par content_type, retourne le count', async () => {
    mockDb.select.mockResolvedValueOnce([
      { stream_id: 10 },
      { stream_id: 20 },
      { stream_id: 30 },
    ]);

    const count = await clearProgressByType('movie');

    expect(count).toBe(3);

    // SELECT pour récupérer les IDs
    const selectCall = mockDb.select.mock.calls.find(
      (c) => (c[0] as string).includes('content_type')
    );
    expect(selectCall).toBeDefined();

    // DELETE par type
    const deleteCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('DELETE FROM playback_progress')
    );
    expect(deleteCall).toBeDefined();

    // Event dispatché
    expect(dispatchSpy).toHaveBeenCalled();

    // Cloud push pour chaque ID supprimé
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledTimes(3);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(10);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(20);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(30);
  });

  // ──────────────────────────────────────────────
  // 14. hasProgress — true/false
  // ──────────────────────────────────────────────
  it('hasProgress — true si existe, false sinon', async () => {
    mockDb.select.mockResolvedValueOnce([{ count: 1 }]);
    expect(await hasProgress(42)).toBe(true);

    mockDb.select.mockResolvedValueOnce([{ count: 0 }]);
    expect(await hasProgress(999)).toBe(false);
  });

  // ──────────────────────────────────────────────
  // 15. Purge auto 500
  // ──────────────────────────────────────────────
  it('finalizePlayback — purge les entrées > 500', async () => {
    // Mock pour le SELECT cloud push post-UPDATE
    mockDb.select.mockResolvedValueOnce([{
      content_type: 'movie',
      tmdb_id: 500,
      title: 'Test Movie',
      poster_url: 'http://poster.jpg',
      series_id: null,
      season_number: null,
      episode_number: null,
      next_episode_id: null,
      next_season: null,
      next_episode_number: null,
      time_seconds: 3000,
      duration_seconds: 6000,
      container_extension: 'mkv',
    }]);

    await finalizePlayback({
      streamId: 42,
      timeSeconds: 3000,
      durationSeconds: 6000, // 50%
    });

    // db.execute appelé 2 fois : UPDATE progression + DELETE purge
    const purgeCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('LIMIT 500')
    );
    expect(purgeCall).toBeDefined();
    expect(purgeCall![0] as string).toContain('DELETE FROM playback_progress');
    // Les reprises retirées restent dans le dernier accord : la synchro les retire du cloud
    expect(forgetForCurrentAccount).not.toHaveBeenCalled();
  });

  // ──────────────────────────────────────────────
  // 16. getProgressByTmdbIds — cas nominal
  // ──────────────────────────────────────────────
  it('getProgressByTmdbIds — retourne Map indexée par tmdb_id', async () => {
    mockDb.select.mockResolvedValueOnce([
      { tmdb_id: 100, time_seconds: 1800, duration_seconds: 6000, updated_at: 1000 },
      { tmdb_id: 200, time_seconds: 900, duration_seconds: 3000, updated_at: 2000 },
    ]);

    const result = await getProgressByTmdbIds([100, 200]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get(100)).toEqual({
      timeSeconds: 1800,
      durationSeconds: 6000,
      progressPercent: 30,
    });
    expect(result.get(200)).toEqual({
      timeSeconds: 900,
      durationSeconds: 3000,
      progressPercent: 30,
    });

    // Vérifie la requête SQL
    const selectCall = mockDb.select.mock.calls.find(
      (c) => (c[0] as string).includes('tmdb_id IN')
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![0] as string).toContain("content_type = 'movie'");
  });

  // ──────────────────────────────────────────────
  // 17. getProgressByTmdbIds — dédup multi-source
  // ──────────────────────────────────────────────
  it('getProgressByTmdbIds — dédup: garde la progression la plus récente par tmdb_id', async () => {
    // Même tmdb_id=100, deux stream_id différents (sources différentes)
    // ORDER BY updated_at DESC → la plus récente en premier
    mockDb.select.mockResolvedValueOnce([
      { tmdb_id: 100, time_seconds: 3600, duration_seconds: 7200, updated_at: 5000 }, // plus récent
      { tmdb_id: 100, time_seconds: 1000, duration_seconds: 7200, updated_at: 1000 }, // ancien
    ]);

    const result = await getProgressByTmdbIds([100]);

    expect(result.size).toBe(1);
    expect(result.get(100)).toEqual({
      timeSeconds: 3600,
      durationSeconds: 7200,
      progressPercent: 50,
    });
  });

  // ──────────────────────────────────────────────
  // 18. getProgressByTmdbIds — tmdb_id=0 ignoré
  // ──────────────────────────────────────────────
  it('getProgressByTmdbIds — filtre les tmdb_id = 0 ou négatifs', async () => {
    const result = await getProgressByTmdbIds([0, -1, 0]);

    // Aucun appel DB car tous les IDs sont invalides
    expect(result.size).toBe(0);
    const selectCalls = mockDb.select.mock.calls;
    expect(selectCalls.length).toBe(0);
  });

  // ──────────────────────────────────────────────
  // 19. getProgressByTmdbIds — tableau vide
  // ──────────────────────────────────────────────
  it('getProgressByTmdbIds — retourne Map vide sur tableau vide', async () => {
    const result = await getProgressByTmdbIds([]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Retirer une carte « Introuvable » de « Reprendre »
// ============================================================================

describe('clearUnavailableResume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockResolvedValue([]);
    mockDb.execute.mockResolvedValue(undefined);
  });

  const selectCall = () => mockDb.select.mock.calls.find((c) => (c[0] as string).includes('FROM playback_progress'));
  const deleteCall = () => mockDb.execute.mock.calls.find((c) => (c[0] as string).includes('DELETE FROM playback_progress'));

  it('film : retire toutes ses reprises (même numéro TMDB), en local et dans le cloud', async () => {
    mockDb.select.mockResolvedValueOnce([{ stream_id: 100 }, { stream_id: 90 }]);

    const count = await clearUnavailableResume({ id: 100, type: 'movie', tmdbId: 1 });

    expect(count).toBe(2);
    const [sql, params] = selectCall()!;
    expect(sql).toContain("content_type = 'movie'");
    expect(params).toEqual([100, 1]);
    expect(deleteCall()![1]).toEqual([100, 90]);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledTimes(2);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(100);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(90);
    // La rangée « Reprendre » se rafraîchit
    expect(dispatchSpy.mock.calls.some((c) => (c[0] as Event).type === 'playbackPositionUpdated')).toBe(true);
  });

  it('film sans numéro TMDB : ne retire que sa propre reprise', async () => {
    mockDb.select.mockResolvedValueOnce([{ stream_id: 100 }]);

    await clearUnavailableResume({ id: 100, type: 'movie', tmdbId: null });

    const [sql, params] = selectCall()!;
    expect(sql).not.toContain('tmdb_id');
    expect(params).toEqual([100]);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledTimes(1);
    expect(pushPlaybackDeleteToCloud).toHaveBeenCalledWith(100);
  });

  // Le numéro de série désigne désormais une autre série : ses épisodes, rangés sous le même
  // numéro, ne sont jamais retirés. Seul le numéro TMDB du titre de la carte compte.
  it('série : retire les épisodes de ce titre seulement, jamais ceux rangés sous le même numéro de série', async () => {
    mockDb.select.mockResolvedValueOnce([{ stream_id: 5001 }, { stream_id: 5002 }]);

    const count = await clearUnavailableResume({ id: 5003, type: 'series', tmdbId: 7, seriesId: 300 });

    expect(count).toBe(2);
    const [sql, params] = selectCall()!;
    expect(sql).toContain("content_type = 'episode'");
    expect(sql).not.toContain('series_id');
    expect(sql).not.toContain('stream_id =');
    expect(params).toEqual([7]);
    // L'épisode affiché (épisode suivant, sans reprise à lui) n'est pas visé : seules les reprises lues
    expect(deleteCall()![1]).toEqual([5001, 5002]);
    expect(pushPlaybackDeleteToCloud).not.toHaveBeenCalledWith(5003);
  });

  // Un épisode enregistré sans numéro TMDB (épisode suivant) sous le même numéro de
  // série reprenait la place de la carte retirée, sans « Introuvable ». Il part s'il n'est pas plus
  // récent que la carte ; un plus récent appartient au titre qui a repris le numéro.
  it('série : retire aussi les épisodes sans numéro TMDB du même numéro, pas plus récents que la carte', async () => {
    mockDb.select.mockResolvedValueOnce([{ stream_id: 5001 }, { stream_id: 4999 }]);

    await clearUnavailableResume({ id: 5001, type: 'series', tmdbId: 7, seriesId: 300, lastWatched: 1000 });

    const [sql, params] = selectCall()!;
    expect(sql).toContain("content_type = 'episode'");
    expect(sql).toContain('series_id = ? AND COALESCE(tmdb_id, 0) <= 0 AND updated_at <= ?');
    expect(params).toEqual([7, 300, 1000]);
    expect(deleteCall()![1]).toEqual([5001, 4999]);
  });

  it('série sans numéro TMDB : rien n\'est retiré', async () => {
    const count = await clearUnavailableResume({ id: 5001, type: 'series', tmdbId: 0, seriesId: 300 });

    expect(count).toBe(0);
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(pushPlaybackDeleteToCloud).not.toHaveBeenCalled();
  });

  it('aucune reprise trouvée : rien n\'est effacé ni envoyé', async () => {
    const count = await clearUnavailableResume({ id: 100, type: 'movie', tmdbId: 1 });

    expect(count).toBe(0);
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(pushPlaybackDeleteToCloud).not.toHaveBeenCalled();
  });
});
