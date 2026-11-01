/**
 * Tests unitaires pour syncService.ts
 *
 * Vérifie :
 * - La logique LWW merge (preferences, playback)
 * - Le merge ensembliste (watchlist, liveTv, hiddenCategories)
 * - Le guard canSync()
 * - Les fire-and-forget upsert/delete par table
 * - La résilience aux erreurs réseau
 *
 * Tous les appels DB et Supabase sont mockés.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bumpGeneration } from '../sync/syncBaseline';

// ============================================================================
// MOCKS
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any -- faux client Supabase : réponses de forme libre */
const mockExecute = vi.fn();
const mockSelect = vi.fn();

vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(() =>
    Promise.resolve({
      select: (...args: any[]) => mockSelect(...args),
      execute: (...args: any[]) => mockExecute(...args),
    })
  ),
  getMeta: vi.fn(() => Promise.resolve(null)),
  setMeta: vi.fn(() => Promise.resolve()),
  isDatabaseOf: vi.fn(() => true),
}));

/**
 * Mock Supabase amélioré :
 * - Traçabilité par table pour les appels upsert/delete
 * - Support du chainage .from().upsert(), .from().delete().eq().eq()
 * - Résultats configurables par table via cloudData et upsertResults
 */
const cloudData: Record<string, { data: unknown[] | null; error: unknown }> = {};
const upsertResults: Record<string, { error: unknown }> = {};

/** Compteurs d'appels fire-and-forget par table */
const upsertCalls: Record<string, { data: any; options: any }[]> = {};
const deleteCalls: Record<string, { filters: Record<string, any> }[]> = {};

function resetCloudData() {
  for (const key of Object.keys(cloudData)) delete cloudData[key];
  for (const key of Object.keys(upsertResults)) delete upsertResults[key];
  for (const key of Object.keys(upsertCalls)) delete upsertCalls[key];
  for (const key of Object.keys(deleteCalls)) delete deleteCalls[key];
}

function setCloudData(table: string, data: unknown[], error: unknown = null) {
  cloudData[table] = { data, error };
}

function setUpsertError(table: string, errorMsg: string) {
  upsertResults[table] = { error: { message: errorMsg } };
}

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const result = cloudData[table] ?? { data: [], error: null };
        const chain: any = {
          eq: () => chain,
          order: () => chain,
          range: () => chain,
          ...result,
        };
        return chain;
      },
      upsert: (data: any, options: any) => {
        if (!upsertCalls[table]) upsertCalls[table] = [];
        upsertCalls[table].push({ data, options });
        const result = upsertResults[table] ?? { error: null };
        // Support .then() pour les fire-and-forget
        return {
          ...result,
          then: (cb: any) => cb(result),
        };
      },
      // Ma liste : mise à jour d'un titre (aucune ligne touchée ici), puis ajout
      update: () => {
        const chain: any = {
          eq: () => chain,
          select: () => chain,
          then: (cb: any) => cb({ data: [], error: null }),
        };
        return chain;
      },
      insert: (data: any) => {
        if (!upsertCalls[table]) upsertCalls[table] = [];
        upsertCalls[table].push({ data, options: 'insert' });
        return { then: (cb: any) => cb({ error: null }) };
      },
      delete: () => {
        const filters: Record<string, any> = {};
        if (!deleteCalls[table]) deleteCalls[table] = [];
        const entry = { filters };
        deleteCalls[table].push(entry);
        const chain: any = {
          eq: (col: string, val: any) => {
            filters[col] = val;
            return chain;
          },
          then: (cb: any) => cb({ error: null }),
          error: null,
        };
        return chain;
      },
    }),
  },
}));

import {
  syncOnLogin,
  setCurrentSyncUserId,
  pushPreferenceToCloud,
  pushWatchlistUpsertToCloud,
  pushWatchlistDeleteToCloud,
  pushPlaybackUpsertToCloud,
  pushPlaybackDeleteToCloud,
  pushLiveTvBookmarkUpsertToCloud,
  pushLiveTvBookmarkDeleteToCloud,
  pushHiddenCategoryToCloud,
  pushHiddenCategoryDeleteToCloud,
} from '../syncService';
import { HIDDEN_CATEGORIES_BOOT_WAIT_MS } from '../sync/syncService';
import { isHidden, resetHiddenCategories } from '../hiddenCategoriesService';
import { clearCloudRefusal, hasCloudRefusal } from '../sync/cloudRefusal';

describe('syncService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockExecute.mockResolvedValue(undefined);
    mockSelect.mockResolvedValue([]);
    resetCloudData();
  });

  afterEach(() => {
    setCurrentSyncUserId(null);
  });

  // ========================================================================
  // canSync() GUARD
  // ========================================================================

  describe('canSync guard', () => {
    it('pas de userId → aucun appel Supabase', () => {
      setCurrentSyncUserId(null);
      pushPreferenceToCloud('theme', 'dark');
      expect(upsertCalls['user_preferences']).toBeUndefined();
    });

    it('userId set → appel Supabase effectué', () => {
      setCurrentSyncUserId('user1');
      pushPreferenceToCloud('theme', 'dark');
      expect(upsertCalls['user_preferences']).toHaveLength(1);
    });
  });

  // ========================================================================
  // FIRE-AND-FORGET PREFERENCES
  // ========================================================================

  describe('Fire-and-forget Preferences', () => {
    beforeEach(() => setCurrentSyncUserId('user1'));

    it('pushPreferenceToCloud envoie un upsert avec les bonnes données', () => {
      pushPreferenceToCloud('language', 'fr');
      expect(upsertCalls['user_preferences']).toHaveLength(1);
      expect(upsertCalls['user_preferences'][0].data).toEqual({
        user_id: 'user1',
        key: 'language',
        value: 'fr',
        updated_at: expect.any(String),
      });
      expect(upsertCalls['user_preferences'][0].options).toEqual({
        onConflict: 'user_id,key',
      });
    });

    it('erreur Supabase → console.warn sans crash', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setUpsertError('user_preferences', 'Network error');
      pushPreferenceToCloud('theme', 'dark');
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('preference upsert failed'),
        'Network error',
      ));
      warnSpy.mockRestore();
    });
  });

  // ========================================================================
  // FIRE-AND-FORGET WATCHLIST
  // ========================================================================

  describe('Fire-and-forget Watchlist', () => {
    beforeEach(() => setCurrentSyncUserId('user1'));

    it('pushWatchlistUpsertToCloud place un titre TMDB par titre (ajout, sans écraser un autre titre)', async () => {
      pushWatchlistUpsertToCloud(456, 123, 'movie');
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Mise à jour par titre (aucune ligne ici), puis ajout : jamais un upsert qui écraserait le
      // titre qui occupe déjà ce numéro dans le cloud
      expect(upsertCalls['user_watchlist']).toHaveLength(1);
      expect(upsertCalls['user_watchlist'][0]).toEqual({
        data: { user_id: 'user1', stream_id: 456, tmdb_id: 123, media_type: 'movie', provider_hash: null },
        options: 'insert',
      });
    });

    it('pushWatchlistUpsertToCloud envoie un upsert pour une ligne sans TMDB', () => {
      pushWatchlistUpsertToCloud(456, 0, 'movie');
      expect(upsertCalls['user_watchlist']).toHaveLength(1);
      expect(upsertCalls['user_watchlist'][0].data).toEqual({
        user_id: 'user1',
        stream_id: 456,
        tmdb_id: 0,
        media_type: 'movie',
        provider_hash: null, // no hash set yet in test context
      });
    });

    it('pushWatchlistDeleteToCloud retire par numéro une ligne sans TMDB', () => {
      pushWatchlistDeleteToCloud(456, 'movie');
      expect(deleteCalls['user_watchlist']).toHaveLength(1);
      expect(deleteCalls['user_watchlist'][0].filters).toEqual({
        user_id: 'user1',
        stream_id: 456,
        media_type: 'movie',
      });
    });

    it('pushWatchlistDeleteToCloud retire un titre TMDB par titre, quel que soit son numéro', () => {
      pushWatchlistDeleteToCloud(-3, 'movie', 123); // numéro provisoire d'une re-liaison interrompue
      expect(deleteCalls['user_watchlist']).toHaveLength(1);
      expect(deleteCalls['user_watchlist'][0].filters).toEqual({
        user_id: 'user1',
        tmdb_id: 123,
        media_type: 'movie',
      });
    });

    it('pas de userId → aucun delete envoyé', () => {
      setCurrentSyncUserId(null);
      pushWatchlistDeleteToCloud(456, 'movie');
      expect(deleteCalls['user_watchlist']).toBeUndefined();
    });
  });

  // ========================================================================
  // FIRE-AND-FORGET PLAYBACK
  // ========================================================================

  describe('Fire-and-forget Playback', () => {
    beforeEach(() => setCurrentSyncUserId('user1'));

    it('pushPlaybackUpsertToCloud envoie les données complètes', () => {
      pushPlaybackUpsertToCloud(789, 'episode', {
        tmdb_id: 100,
        title: 'Test Episode',
        poster_url: 'https://img.test/poster.jpg',
        series_id: 50,
        season_number: 2,
        episode_number: 5,
        next_episode_id: '6',
        next_season: 2,
        next_episode_number: 6,
        time_seconds: 1200,
        duration_seconds: 2400,
        container_extension: 'mkv',
      });

      expect(upsertCalls['user_playback_progress']).toHaveLength(1);
      const data = upsertCalls['user_playback_progress'][0].data;
      expect(data.user_id).toBe('user1');
      expect(data.stream_id).toBe(789);
      expect(data.content_type).toBe('episode');
      expect(data.time_seconds).toBe(1200);
      expect(data.duration_seconds).toBe(2400);
      expect(data.series_id).toBe(50);
      expect(data.next_episode_id).toBe('6');
      expect(data).toHaveProperty('provider_hash', null); // fournisseur noté (aucun ici)
    });

    it("pushPlaybackUpsertToCloud n'envoie que les affiches TMDB", () => {
      pushPlaybackUpsertToCloud(1, 'movie', {
        title: 'TMDB', poster_url: 'https://image.tmdb.org/t/p/w500/a.jpg', time_seconds: 1, duration_seconds: 2,
      });
      pushPlaybackUpsertToCloud(2, 'movie', {
        title: 'Fournisseur', poster_url: 'http://provider.example:8080/images/b.jpg', time_seconds: 1, duration_seconds: 2,
      });
      const [tmdb, provider] = upsertCalls['user_playback_progress'].map((call) => call.data);
      expect(tmdb.poster_url).toBe('https://image.tmdb.org/t/p/w500/a.jpg');
      expect(provider.poster_url).toBeNull();
    });

    it('pushPlaybackUpsertToCloud gère les champs optionnels null', () => {
      pushPlaybackUpsertToCloud(789, 'movie', {
        title: 'Test Movie',
        time_seconds: 600,
        duration_seconds: 5400,
      });

      const data = upsertCalls['user_playback_progress'][0].data;
      expect(data.tmdb_id).toBe(0);
      expect(data.poster_url).toBeNull();
      expect(data.series_id).toBeNull();
      expect(data.container_extension).toBeNull();
    });

    it('pushPlaybackDeleteToCloud envoie les bons filtres', () => {
      pushPlaybackDeleteToCloud(789);
      expect(deleteCalls['user_playback_progress']).toHaveLength(1);
      expect(deleteCalls['user_playback_progress'][0].filters).toEqual({
        user_id: 'user1',
        stream_id: 789,
      });
    });

    it('erreur Supabase upsert → console.warn sans crash', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      setUpsertError('user_playback_progress', 'Timeout');
      pushPlaybackUpsertToCloud(789, 'movie', {
        title: 'X',
        time_seconds: 0,
        duration_seconds: 0,
      });
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('playback upsert failed'),
        'Timeout',
      ));
      warnSpy.mockRestore();
    });
  });

  // ========================================================================
  // FIRE-AND-FORGET LIVETV BOOKMARKS
  // ========================================================================

  describe('Fire-and-forget LiveTV Bookmarks', () => {
    beforeEach(() => setCurrentSyncUserId('user1'));

    it('pushLiveTvBookmarkUpsertToCloud envoie un upsert favorite', () => {
      pushLiveTvBookmarkUpsertToCloud('favorite', '12345');
      expect(upsertCalls['user_livetv_bookmarks']).toHaveLength(1);
      expect(upsertCalls['user_livetv_bookmarks'][0].data).toEqual({
        user_id: 'user1',
        bookmark_type: 'favorite',
        item_id: '12345',
        provider_hash: null, // (aucun fournisseur noté dans ce test)
      });
    });

    it('pushLiveTvBookmarkUpsertToCloud envoie un upsert pinned_category', () => {
      pushLiveTvBookmarkUpsertToCloud('pinned_category', 'sports');
      expect(upsertCalls['user_livetv_bookmarks'][0].data).toEqual({
        user_id: 'user1',
        bookmark_type: 'pinned_category',
        item_id: 'sports',
        provider_hash: null,
      });
    });

    it('pushLiveTvBookmarkDeleteToCloud envoie un delete avec les bons filtres', () => {
      pushLiveTvBookmarkDeleteToCloud('favorite', '12345');
      expect(deleteCalls['user_livetv_bookmarks']).toHaveLength(1);
      expect(deleteCalls['user_livetv_bookmarks'][0].filters).toEqual({
        user_id: 'user1',
        bookmark_type: 'favorite',
        item_id: '12345',
      });
    });
  });

  // ========================================================================
  // FIRE-AND-FORGET HIDDEN CATEGORIES
  // ========================================================================

  describe('Fire-and-forget Hidden Categories', () => {
    beforeEach(() => setCurrentSyncUserId('user1'));

    it('pushHiddenCategoryToCloud envoie un upsert correct', () => {
      pushHiddenCategoryToCloud('42', 'movie');
      expect(upsertCalls['user_hidden_categories']).toHaveLength(1);
      expect(upsertCalls['user_hidden_categories'][0].data).toEqual({
        user_id: 'user1',
        category_id: '42',
        category_type: 'movie',
        provider_hash: null,
      });
      expect(upsertCalls['user_hidden_categories'][0].options).toEqual({
        onConflict: 'user_id,category_id,category_type',
      });
    });

    it('pushHiddenCategoryDeleteToCloud envoie un delete avec les bons filtres', () => {
      pushHiddenCategoryDeleteToCloud('42', 'movie');
      expect(deleteCalls['user_hidden_categories']).toHaveLength(1);
      expect(deleteCalls['user_hidden_categories'][0].filters).toEqual({
        user_id: 'user1',
        category_id: '42',
        category_type: 'movie',
      });
    });

    it('pas de userId → aucun appel', () => {
      setCurrentSyncUserId(null);
      pushHiddenCategoryToCloud('42', 'movie');
      pushHiddenCategoryDeleteToCloud('42', 'movie');
      expect(upsertCalls['user_hidden_categories']).toBeUndefined();
      expect(deleteCalls['user_hidden_categories']).toBeUndefined();
    });
  });

  // ========================================================================
  // PREFERENCES MERGE LWW (sync au login)
  // ========================================================================

  describe('Preferences merge LWW', () => {
    beforeEach(() => setCurrentSyncUserId('user1')); // comme useSessionLifecycle avant syncOnLogin
    /** Préférences locales, rendues selon la requête : les autres synchros lisent en parallèle */
    function localPrefs(rows: { key: string; value: string; updated_at: number }[]) {
      mockSelect.mockImplementation(((sql: string) =>
        Promise.resolve(sql.includes('FROM user_preferences') ? rows : [])) as any);
    }

    it('cloud plus récent → update local', async () => {
      const cloudTimestamp = new Date(Date.now() - 1 * 3600 * 1000).toISOString(); // 1h ago
      const localTimestamp = Date.now() - 3 * 3600 * 1000; // 3h ago

      setCloudData('user_preferences', [
        { user_id: 'user1', key: 'theme', value: 'dark', updated_at: cloudTimestamp },
      ]);

      // Local prefs query
      localPrefs([
        { key: 'theme', value: 'light', updated_at: localTimestamp },
      ]);

      const result = await syncOnLogin('user1');
      expect(result.preferences.pulled).toBe(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO user_preferences'),
        expect.arrayContaining(['theme', 'dark']),
      );
    });

    it('local plus récent → push cloud', async () => {
      const cloudTimestamp = new Date(Date.now() - 3 * 3600 * 1000).toISOString(); // 3h ago
      const localTimestamp = Date.now() - 1 * 3600 * 1000; // 1h ago

      setCloudData('user_preferences', [
        { user_id: 'user1', key: 'theme', value: 'dark', updated_at: cloudTimestamp },
      ]);

      localPrefs([
        { key: 'theme', value: 'light', updated_at: localTimestamp },
      ]);

      const result = await syncOnLogin('user1');
      expect(result.preferences.pushed).toBe(1);
    });

    it('item local-only → push cloud', async () => {
      setCloudData('user_preferences', []);

      localPrefs([
        { key: 'newPref', value: 'yes', updated_at: Date.now() },
      ]);

      const result = await syncOnLogin('user1');
      expect(result.preferences.pushed).toBe(1);
    });
  });

  // ========================================================================
  // WATCHLIST MERGE ENSEMBLISTE (sync au login)
  // ========================================================================

  describe('Watchlist merge ensembliste', () => {
    beforeEach(() => setCurrentSyncUserId('user1')); // comme useSessionLifecycle avant syncOnLogin
    it('item cloud-only (nouveau) → insert local', async () => {
      const now = new Date().toISOString();
      setCloudData('user_watchlist', [
        {
          user_id: 'user1', tmdb_id: 123, media_type: 'movie',
          stream_id: 456, added_at: now, updated_at: now,
        },
      ]);

      // Local watchlist vide
      mockSelect.mockImplementation(((query: string) => {
        if (typeof query === 'string' && query.includes('FROM watchlist')) return Promise.resolve([]);
        return Promise.resolve([]);
      }) as any);

      const result = await syncOnLogin('user1');
      expect(result.watchlist.pulled).toBeGreaterThanOrEqual(1);
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO watchlist'),
        expect.arrayContaining([456, 123, 'movie']),
      );
    });

    it('item cloud-only → toujours inséré localement (pas de suppression)', async () => {
      setCloudData('user_watchlist', [
        {
          user_id: 'user1', tmdb_id: 123, media_type: 'movie',
          stream_id: 456, added_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        },
      ]);

      mockSelect.mockImplementation(((query: string) => {
        if (typeof query === 'string' && query.includes('FROM watchlist')) return Promise.resolve([]);
        return Promise.resolve([]);
      }) as any);

      const result = await syncOnLogin('user1');
      expect(result.watchlist.pulled).toBeGreaterThanOrEqual(1);
      // Merge ensembliste additif : pas de deleted dans SyncResult
    });

    it('item local-only → push cloud', async () => {
      setCloudData('user_watchlist', []);
      setCurrentSyncUserId('user1'); // comme useSessionLifecycle, juste avant syncOnLogin

      mockSelect.mockImplementation(((query: string) => {
        if (typeof query === 'string' && query.includes('FROM watchlist')) {
          return Promise.resolve([
            { stream_id: 789, tmdb_id: 321, type: 'series', added_at: Date.now(), updated_at: Date.now() },
          ]);
        }
        return Promise.resolve([]);
      }) as any);

      const result = await syncOnLogin('user1');
      expect(result.watchlist.pushed).toBe(1);
    });
  });

  // ========================================================================
  // CATÉGORIES MASQUÉES AU DÉMARRAGE
  // ========================================================================

  describe('Catégories masquées au démarrage', () => {
    beforeEach(() => setCurrentSyncUserId('user1')); // comme useSessionLifecycle avant syncOnLogin
    /** Petite table hidden_categories en mémoire, lecture ralentie comme une vraie base */
    function useHiddenTable(initial: { category_id: string; type: string }[], readDelayMs = 20) {
      const rows = [...initial];
      mockExecute.mockImplementation((async (sql: string, params: string[]) => {
        if (sql.includes('INSERT OR IGNORE INTO hidden_categories')) {
          rows.push({ category_id: params[0], type: params[1] });
        }
      }) as any);
      mockSelect.mockImplementation((async (sql: string) => {
        if (!sql.includes('FROM hidden_categories')) return [];
        await new Promise((r) => setTimeout(r, readDelayMs));
        return rows.map((r) => ({ ...r }));
      }) as any);
    }

    beforeEach(() => resetHiddenCategories());
    afterEach(() => {
      vi.useRealTimers();
      bumpGeneration(); // une synchro restée sans réponse ne retient pas celles des tests suivants
    });

    it('une catégorie masquée sur un autre appareil est appliquée avant la fin de syncOnLogin', async () => {
      setCloudData('user_hidden_categories', [
        { user_id: 'user1', category_id: '42', category_type: 'movie' },
      ]);
      useHiddenTable([]);

      await syncOnLogin('user1');

      // L'accueil s'affiche juste après syncOnLogin : la catégorie doit déjà être masquée
      expect(isHidden('42', 'movie')).toBe(true);
    });

    it("l'échec de l'envoi des catégories locales n'empêche pas d'appliquer celles du cloud", async () => {
      setCloudData('user_hidden_categories', [
        { user_id: 'user1', category_id: '42', category_type: 'movie' },
      ]);
      setUpsertError('user_hidden_categories', 'Network error');
      useHiddenTable([{ category_id: '7', type: 'live' }]);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await syncOnLogin('user1');

      expect(isHidden('42', 'movie')).toBe(true);
      consoleSpy.mockRestore();
    });

    // La base refuse un numéro de plus de 128 octets, et ce refus bloquait tout
    // l'envoi des catégories masquées. Le numéro démesuré reste sur l'appareil, les autres partent.
    it('une catégorie locale au numéro démesuré reste sur l’appareil, les autres partent', async () => {
      useHiddenTable([{ category_id: '7', type: 'live' }, { category_id: 'x'.repeat(129), type: 'live' }]);
      await syncOnLogin('user1');
      await vi.waitFor(() => expect(upsertCalls['user_hidden_categories']).toHaveLength(1));
      expect(upsertCalls['user_hidden_categories'][0].data.map((r: { category_id: string }) => r.category_id)).toEqual(['7']);
      // Gardée sur l'appareil : jamais retirée de la table locale
      expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'), expect.arrayContaining(['x'.repeat(129)]));
    });

    it('favori TV : une catégorie épinglée au numéro démesuré reste sur l’appareil, les autres partent', async () => {
      mockSelect.mockImplementation((async (sql: string) => {
        if (sql.includes('FROM live_tv_pinned_categories')) return [{ category_id: '5' }, { category_id: 'y'.repeat(129) }];
        return [];
      }) as any);
      await syncOnLogin('user1');
      await vi.waitFor(() => expect(upsertCalls['user_livetv_bookmarks']).toHaveLength(1));
      expect(upsertCalls['user_livetv_bookmarks'][0].data.map((r: { item_id: string }) => r.item_id)).toEqual(['5']);
      expect(mockExecute).not.toHaveBeenCalledWith(expect.stringContaining('DELETE'), expect.arrayContaining(['y'.repeat(129)]));
    });

    it('envoi refusé pour une borne dépassée : noté pour l’écran, effacé après une synchro complète', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      clearCloudRefusal();
      upsertResults['user_hidden_categories'] = { error: { message: 'violates check constraint', code: '23514' } };
      useHiddenTable([{ category_id: '7', type: 'live' }]);
      await syncOnLogin('user1');
      await vi.waitFor(() => expect(hasCloudRefusal()).toBe(true));
      delete upsertResults['user_hidden_categories'];
      await syncOnLogin('user1');
      await vi.waitFor(() => expect(hasCloudRefusal()).toBe(false));
      consoleSpy.mockRestore();
    });

    it("un cloud qui ne répond pas ne retient pas l'ouverture plus que le délai prévu", async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      mockSelect.mockImplementation(((sql: string) => {
        if (sql.includes('FROM hidden_categories')) return new Promise(() => {}); // jamais de réponse
        return Promise.resolve([]);
      }) as any);

      let done = false;
      const pending = syncOnLogin('user1').then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(HIDDEN_CATEGORIES_BOOT_WAIT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    });
  });

  // ========================================================================
  // ERROR HANDLING
  // ========================================================================

  describe('Error handling', () => {
    beforeEach(() => setCurrentSyncUserId('user1')); // comme useSessionLifecycle avant syncOnLogin
    it('sync graceful sur erreur réseau (catch, log, continue)', async () => {
      setCloudData('user_preferences', []);
      // Force error on all tables
      cloudData['user_preferences'] = { data: null, error: { message: 'Network error' } };
      cloudData['user_watchlist'] = { data: null, error: { message: 'Network error' } };
      cloudData['user_playback_progress'] = { data: null, error: { message: 'Network error' } };
      cloudData['user_hidden_categories'] = { data: null, error: { message: 'Network error' } };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await syncOnLogin('user1');

      // Prefs, watchlist et catégories masquées sont attendues : leurs erreurs sont dans
      // result.errors au retour. Playback + LiveTv sont fire-and-forget (.catch) : leurs erreurs
      // peuvent arriver avant ou après.
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.stringContaining('Preferences sync failed'),
        expect.stringContaining('Watchlist sync failed'),
        expect.stringContaining('HiddenCategories sync failed'),
      ]));
      consoleSpy.mockRestore();
    });
  });
});
