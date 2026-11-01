/**
 * Debug Tools — SQLite debug functions exposed on window
 *
 * Isolated from production code. Import this file to register
 * debug commands in the DevTools console.
 */

/* eslint-disable no-console -- commandes window.debug* tapées à la main dans la console (docs/CONVENTIONS.md) */

import { getDatabase, purgeAllTables } from './dbCore';
import { TMDB_LANGUAGE_EVENT } from './eventConstants';

// ============================================================================
// DEBUG FUNCTIONS (exposed on window for DevTools console)
// ============================================================================

if (typeof window !== 'undefined') {
  /**
   * Clear all data from ALL SQLite tables (keeps structure)
   */
  (window as unknown as Record<string, unknown>).debugClearSQLite = async () => {
    await purgeAllTables();
    console.log('✅ All SQLite tables purged!');
  };

  /**
   * Show SQLite table statistics
   */
  (window as unknown as Record<string, unknown>).debugSQLiteStats = async () => {
    const database = await getDatabase();
    try {
      const [movies, series, live, cats, search] = await Promise.all([
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM movies'),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM series'),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM live'),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM categories'),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM search_index').catch(() => [{ count: -1 }]),
      ]);
      console.table({
        movies: movies[0].count,
        series: series[0].count,
        live: live[0].count,
        categories: cats[0].count,
        search_index: search[0].count,
      });
    } catch (e) {
      console.error('Stats error:', e);
    }
  };

  /**
   * FULL RESET: Purge all tables + caches + delete .db file + relaunch app.
   * ⚠️  L'app redémarre automatiquement (appRestart.ts : page rechargée sur Android).
   */
  (window as unknown as Record<string, unknown>).debugFullReset = async () => {
    const { performFullReset } = await import('./fullResetService');
    await performFullReset();
  };

  /**
   * Drop and recreate just the search_index table
   */
  (window as unknown as Record<string, unknown>).debugDropSearchIndex = async () => {
    const database = await getDatabase();
    console.log('Dropping search_index...');
    await database.execute('DROP TABLE IF EXISTS search_index').catch(() => {});
    console.log('✅ search_index dropped. Please restart the app to recreate it.');
  };

  /**
   * Test FTS5 search directly - shows raw results and normalized values
   */
  (window as unknown as Record<string, unknown>).debugSearchTest = async (query: string) => {
    const database = await getDatabase();

    // Show what the query gets normalized to
    const normalized = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const words = normalized.split(' ').filter((w: string) => w.length > 0);
    const ftsQuery = words.map((w: string) => `${w}*`).join(' ');

    console.log('--- FTS5 Search Debug ---');
    console.log('Original query:', query);
    console.log('Normalized query:', normalized);
    console.log('FTS5 query:', ftsQuery);
    console.log('');

    try {
      // Test search on normalized_name
      const results = await database.select<{
        content_id: number;
        name: string;
        normalized_name: string;
        content_type: string;
      }[]>(
        `SELECT content_id, name, normalized_name, content_type 
         FROM search_index 
         WHERE normalized_name MATCH ? 
         ORDER BY rank
         LIMIT 20`,
        [ftsQuery]
      );

      console.log(`Found ${results.length} results:`);
      console.table(results.map(r => ({
        id: r.content_id,
        type: r.content_type,
        name: r.name.substring(0, 40),
        normalized: r.normalized_name.substring(0, 40),
      })));

      // Also show some sample indexed data
      console.log('');
      console.log('--- Sample indexed data containing "spider" ---');
      const samples = await database.select<{ name: string; normalized_name: string }[]>(
        `SELECT name, normalized_name FROM search_index 
         WHERE normalized_name LIKE '%spider%' LIMIT 10`
      );
      console.table(samples);

    } catch (e) {
      console.error('Search test error:', e);
    }
  };

  /**
   * Reset Dashboard: clears TMDB cache + module cache, triggers re-fetch.
   * Dashboard shows skeletons → fresh content. No logout needed.
   */
  (window as unknown as Record<string, unknown>).resetDashboard = async () => {
    const { clearAllCache } = await import('./tmdbCacheSqlite');
    const { resetDashboardCache } = await import('../hooks/useDashboardData');

    console.log('🔄 Clearing TMDB SQLite cache...');
    await clearAllCache();

    console.log('🔄 Resetting dashboard module cache...');
    resetDashboardCache();

    console.log('🔄 Dispatching language change event to force re-fetch...');
    window.dispatchEvent(new Event(TMDB_LANGUAGE_EVENT));

    console.log('✅ Dashboard reset! Skeletons should appear → fresh content loads.');
  };

  /**
   * Provider Status: show lastProvider meta + provider-specific table row counts.
   * Use this to verify the state before/after a provider change.
   */
  (window as unknown as Record<string, unknown>).debugProviderStatus = async () => {
    const { getMeta } = await import('./dbCore');
    const database = await getDatabase();

    const lastProvider = await getMeta('lastProvider');
    console.log('--- Provider Status ---');
    console.log('lastProvider (meta):', lastProvider || '(not set — first login)');

    try {
      const [playback, favorites, pins, playerPrefs] = await Promise.all([
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM playback_progress').catch(() => [{ count: -1 }]),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM live_tv_favorites').catch(() => [{ count: -1 }]),
        database.select<{ count: number }[]>('SELECT COUNT(*) as count FROM live_tv_pinned_categories').catch(() => [{ count: -1 }]),
        database.select<{ count: number }[]>(`SELECT COUNT(*) as count FROM content_preferences WHERE content_type = 'player'`).catch(() => [{ count: -1 }]),
      ]);
      console.table({
        playback_progress: playback[0].count,
        live_tv_favorites: favorites[0].count,
        live_tv_pinned_categories: pins[0].count,
        content_preferences_player: playerPrefs[0].count,
      });
      console.log('💡 After a provider change + re-login, all counts above should be 0.');
    } catch (e) {
      console.error('Provider status error:', e);
    }
  };

  /**
   * Simulate Provider Change: sets lastProvider to a fake host.
   * On next login or "Refresh Sources", the wipe will trigger automatically.
   *
   * Usage:
   *   1. Run: window.debugSimulateProviderChange()
   *   2. Go to Settings → click "Refresh Sources" (or re-login)
   *   3. Check: window.debugProviderStatus() → all counts should be 0
   */
  (window as unknown as Record<string, unknown>).debugSimulateProviderChange = async () => {
    const { setMeta, getMeta } = await import('./dbCore');

    const current = await getMeta('lastProvider');
    const fakeHost = 'http://fake-provider-change-test:9999';

    await setMeta('lastProvider', fakeHost);
    console.log('--- Simulate Provider Change ---');
    console.log('Previous lastProvider:', current || '(not set)');
    console.log('New lastProvider (fake):', fakeHost);
    console.log('');
    console.log('✅ Done! Now do ONE of these to trigger the wipe:');
    console.log('   → Settings → "Rafraîchir les sources"');
    console.log('   → Or: logout + re-login');
    console.log('');
    console.log('Then run: window.debugProviderStatus() to verify tables are empty.');
  };

  console.log('[SQLite Debug] Available commands:');
  console.log('  - window.debugSQLiteStats()    : Show table row counts');
  console.log('  - window.debugClearSQLite()    : Clear data (keep structure)');
  console.log('  - window.debugDropSearchIndex(): Drop search_index table');
  console.log('  - window.debugFullReset()      : ⚠️  FULL RESET (drop everything)');
  console.log('  - window.debugSearchTest("query"): Test FTS5 search');
  console.log('  - window.resetDashboard()      : 🔄 Reset dashboard (skeletons → re-fetch)');
  console.log('  - window.debugProviderStatus() : 📊 Show provider + table counts');
  console.log('  - window.debugSimulateProviderChange(): 🔀 Fake a provider change (triggers wipe on next login/refresh)');
}
