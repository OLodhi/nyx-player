/**
 * Debug Utils - Outils de diagnostic RAM et Cache
 * 
 * Usage dans la console dev:
 * - window.debugCache.stats() → Affiche les stats de tous les caches
 * - window.debugCache.sizeOf(obj) → Estime la taille d'un objet en KB
 * - window.debugCache.purgeCache() → Purge le cache WebView2 (libère la RAM renderer)
 */

/* eslint-disable no-console -- commandes window.debug* tapées à la main dans la console (docs/CONVENTIONS.md) */

import { invoke } from '@tauri-apps/api/core';
import { getDetailCacheStats, clearDetailCache } from './detailFetcher';

// Estimation de la taille d'un objet en bytes
function roughSizeOfObject(object: unknown): number {
  const objectList: unknown[] = [];
  const stack: unknown[] = [object];
  let bytes = 0;

  while (stack.length) {
    const value = stack.pop();

    if (typeof value === 'boolean') {
      bytes += 4;
    } else if (typeof value === 'string') {
      bytes += (value as string).length * 2;
    } else if (typeof value === 'number') {
      bytes += 8;
    } else if (typeof value === 'object' && value !== null && !objectList.includes(value)) {
      objectList.push(value);
      for (const key in value as Record<string, unknown>) {
        bytes += key.length * 2; // Key size
        stack.push((value as Record<string, unknown>)[key]);
      }
    }
  }
  return bytes;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Stats du localStorage
function getLocalStorageStats(): { key: string; size: string; bytes: number }[] {
  const stats: { key: string; size: string; bytes: number }[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key) || '';
      const bytes = value.length * 2; // UTF-16
      stats.push({ key, size: formatBytes(bytes), bytes });
    }
  }
  
  return stats.sort((a, b) => b.bytes - a.bytes);
}

// Stats du TMDB cache (SQLite) - async version
async function getTmdbCacheStats(): Promise<{
  movies: number;
  series: number;
  seasons: number;
  lists: number;
  xtreamSeries: number;
  total: number;
}> {
  try {
    const { getCacheStats } = await import('./tmdbCacheSqlite');
    return await getCacheStats();
  } catch {
    return { movies: 0, series: 0, seasons: 0, lists: 0, xtreamSeries: 0, total: 0 };
  }
}

// Affiche toutes les stats
async function showStats(): Promise<void> {
  console.group('📊 Cache Debug Stats');
  
  // Detail Cache LRU (RAM)
  const detailStats = getDetailCacheStats();
  console.log(`\n🧠 Detail Cache (RAM LRU):`);
  console.log(`   Items: ${detailStats.size} / ${detailStats.maxSize}`);
  
  // TMDB Cache (SQLite)
  const tmdbStats = await getTmdbCacheStats();
  console.log(`\n🎬 TMDB Cache (SQLite):`);
  console.log(`   Movies: ${tmdbStats.movies}`);
  console.log(`   Series: ${tmdbStats.series}`);
  console.log(`   Seasons: ${tmdbStats.seasons}`);
  console.log(`   Lists: ${tmdbStats.lists}`);
  console.log(`   Xtream Series: ${tmdbStats.xtreamSeries}`);
  console.log(`   Total: ${tmdbStats.total}`);
  
  // All localStorage
  const lsStats = getLocalStorageStats();
  const totalLs = lsStats.reduce((sum, s) => sum + s.bytes, 0);
  console.log(`\n💾 All localStorage: ${formatBytes(totalLs)}`);
  console.table(lsStats.slice(0, 10)); // Top 10
  
  console.groupEnd();
}

// Clear ALL caches (credentials + localStorage + SQLite + full reload)
async function clearAll(): Promise<void> {
  console.group('🧹 Clearing ALL caches...');
  
  // 1. Clear credentials from OS Keychain
  try {
    const { StorageService } = await import('./storage');
    await StorageService.clearCredentials();
    console.log('✅ OS Keychain credentials cleared');
  } catch (e) {
    console.error('❌ Failed to clear OS Keychain:', e);
  }

  // 2. Clear localStorage
  localStorage.clear();
  console.log('✅ localStorage cleared');
  
  // 3. Clear SQLite
  try {
    const { clearAllData } = await import('./dbCore');
    await clearAllData();
    console.log('✅ SQLite cleared');
  } catch (e) {
    console.error('❌ Failed to clear SQLite:', e);
  }
  
  // 4. Nuclear reload — détruit TOUT l'état RAM (module caches, React state, closures)
  // Aucune maintenance requise lors de l'ajout de futurs caches
  console.log('🎉 All persistent data cleared. Reloading...');
  console.groupEnd();
  window.location.reload();
}

// Purge le cache interne de WebView2/Chromium (libère la RAM renderer)
async function purgeWebviewCache(): Promise<void> {
  console.log('🧹 Purging WebView2 cache...');
  try {
    const result = await invoke<string>('purge_webview_cache');
    console.log(`✅ ${result}`);
    console.log('💡 Observe la RAM dans le Gestionnaire de tâches (WebView2 : Nyx Player)');
  } catch (e) {
    console.error('❌ Failed to purge WebView2 cache:', e);
  }
}

// Force le renderer WebView2 à libérer ses bitmaps décodés (Low → 3s → Normal)
async function trimMemory(): Promise<void> {
  console.log('🧠 Forcing renderer memory trim (Low → 3s → Normal)...');
  console.log('💡 Observe le process "WebView2 : Nyx Player" dans le Gestionnaire de tâches');
  try {
    const result = await invoke<string>('trim_memory');
    console.log(`✅ ${result}`);
  } catch (e) {
    console.error('❌ Failed to trim memory:', e);
  }
}

// Switch en mode Low permanent (purge agressive continue)
async function setLow(): Promise<void> {
  try {
    const result = await invoke<string>('set_memory_low');
    console.log(`⬇ ${result}`);
  } catch (e) {
    console.error('❌ Failed:', e);
  }
}

// Switch en mode Normal (performance max, cache tout)
async function setNormal(): Promise<void> {
  try {
    const result = await invoke<string>('set_memory_normal');
    console.log(`⬆ ${result}`);
  } catch (e) {
    console.error('❌ Failed:', e);
  }
}

// Exporte vers window pour usage console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).debugCache = {
    stats: showStats,
    sizeOf: (obj: unknown) => formatBytes(roughSizeOfObject(obj)),
    clearDetailCache,
    clearAll, // 🆕 Efface TOUT
    purgeCache: purgeWebviewCache, // 🧹 Purge le disk cache WebView2
    trimMemory, // 🧠 Cycle Low → 3s → Normal
    setLow,    // ⬇ Mode Low permanent
    setNormal, // ⬆ Retour mode Normal
    getLocalStorageStats,
    getTmdbCacheStats,
    getDetailCacheStats,
  };
  console.log('🔧 Debug cache tools loaded. Use window.debugCache.stats() or window.debugCache.purgeCache()');
}

