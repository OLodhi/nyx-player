/**
 * DevLog — Système de logging développeur activable depuis la console F12
 *
 * USAGE :
 *   Dans la console browser :
 *     window.enableDevLog()         → Active tous les logs
 *     window.enableDevLog('session') → Active uniquement la catégorie 'session'
 *     window.disableDevLog()        → Désactive tout
 *
 *   Dans le code :
 *     import { devLog } from '../utils/devLog';
 *     devLog('session', 'Login réussi', { username });
 *
 * CATÉGORIES :
 *   session  — login, logout, resume, credentials
 *   player   — playback start/stop, progress save, seek
 *   nav      — tab change, page open/close, goBack
 *   data     — ingestion, SQLite, indexes
 *   tmdb     — matching, cache, API calls
 *   prefs    — preferences changes
 *   memory   — WebView2 memory purge events
 *   sync     — cloud sync (Supabase push/pull)
 *   updater  — Tauri auto-update lifecycle
 *   perf     — performance timing measurements
 */

import { maskLogValue } from './logger';
import { sanitizeIptvUrl } from './sanitizeUrl';

const STORAGE_KEY = 'devlog_enabled';
const STORAGE_FILTER_KEY = 'devlog_filter';

type DevLogCategory = 'session' | 'player' | 'nav' | 'data' | 'tmdb' | 'prefs' | 'memory' | 'sync' | 'updater' | 'perf' | 'epg';

const CATEGORY_COLORS: Record<DevLogCategory, string> = {
  session: '#4CAF50',  // green
  player: '#FF9800',   // orange
  nav: '#2196F3',      // blue
  data: '#9C27B0',     // purple
  tmdb: '#E91E63',     // pink
  prefs: '#00BCD4',    // cyan
  memory: '#FF5722',   // deep orange
  sync: '#3F51B5',     // indigo
  updater: '#607D8B',  // blue grey
  perf: '#795548',     // brown
  epg: '#4a4ad0',      // nyx violet
};

const CATEGORY_ICONS: Record<DevLogCategory, string> = {
  session: '🔐',
  player: '▶️',
  nav: '🧭',
  data: '💾',
  tmdb: '🎬',
  prefs: '⚙️',
  memory: '🧹',
  sync: '☁️',
  updater: '📦',
  perf: '⏱️',
  epg: '📡',
};

function isEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function getFilter(): string | null {
  return localStorage.getItem(STORAGE_FILTER_KEY);
}

/**
 * Log conditionnel — n'affiche rien si devLog est désactivé.
 * Activable depuis la console F12 avec window.enableDevLog().
 * Identifiants Xtream masqués comme dans le journal normal, message et détails compris.
 */
export function devLog(category: DevLogCategory, message: string, ...args: unknown[]): void {
  if (!isEnabled()) return;

  const filter = getFilter();
  if (filter && filter !== category) return;

  const color = CATEGORY_COLORS[category] || '#999';
  const icon = CATEGORY_ICONS[category] || '📝';

  console.log(
    `%c${icon} [${category.toUpperCase()}]%c ${sanitizeIptvUrl(message)}`,
    `color: ${color}; font-weight: bold`,
    'color: inherit',
    ...args.map((arg) => maskLogValue(arg))
  );
}

// ============================================================================
// WINDOW COMMANDS (console F12)
// ============================================================================

if (typeof window !== 'undefined') {
  const win = window as unknown as Record<string, unknown>;

  win.enableDevLog = (category?: string) => {
    localStorage.setItem(STORAGE_KEY, 'true');
    if (category) {
      localStorage.setItem(STORAGE_FILTER_KEY, category);
      console.log(`✅ DevLog activé (filtre: ${category})`);
    } else {
      localStorage.removeItem(STORAGE_FILTER_KEY);
      console.log('✅ DevLog activé (toutes catégories)');
    }
    console.log('   Catégories: session, player, nav, data, tmdb, prefs, memory, sync, updater, perf, epg');
    console.log('   Pour désactiver: window.disableDevLog()');
  };

  win.disableDevLog = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_FILTER_KEY);
    console.log('🔇 DevLog désactivé');
  };
}
