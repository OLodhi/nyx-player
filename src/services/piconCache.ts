/**
 * piconCache.ts — Cache des URLs de picons (logos de chaînes TV).
 *
 * Architecture double-couche :
 * 1. Cache mémoire (Map) → résolution synchrone pour le rendu (<ChannelLogo>)
 * 2. SQLite (`picon_cache` table) → persistance entre redémarrages
 *
 * Au boot, la table est chargée en mémoire (hydrate).
 * Les écritures sont fire-and-forget vers SQLite + immédiates en mémoire.
 *
 * Migration one-shot depuis localStorage au premier boot.
 */

import { getDatabase } from './dbCore';
import { createLogger } from '../utils/logger';

const log = createLogger('PiconCache');

// ============================================================================
// CONSTANTS
// ============================================================================

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 jours en ms

// ============================================================================
// IN-MEMORY CACHE (synchrone)
// ============================================================================

interface PiconCacheEntry {
  url: string | null; // null = vérifié mais pas trouvé
  timestamp: number;
}

/** Cache mémoire pour résolution synchrone. Hydraté depuis SQLite au boot. */
const memoryCache = new Map<string, PiconCacheEntry>();


// ============================================================================
// INIT — Création de la table + hydratation en mémoire
// ============================================================================

/**
 * Initialise la table SQLite et hydrate le cache mémoire.
 * Doit être appelé une seule fois au boot de l'application.
 */
export async function initPiconCache(): Promise<void> {
  try {
    const db = await getDatabase();

    // Table créée par MERGED_SCHEMA dans dbCore.ts (CREATE TABLE IF NOT EXISTS)

    // Purger les entrées expirées
    const cutoff = Date.now() - CACHE_TTL;
    await db.execute('DELETE FROM picon_cache WHERE updated_at < ?', [cutoff]);

    // Hydrater le cache mémoire
    const rows = await db.select<{ channel_key: string; url: string | null; updated_at: number }[]>(
      'SELECT channel_key, url, updated_at FROM picon_cache'
    );

    for (const row of rows) {
      memoryCache.set(row.channel_key, {
        url: row.url,
        timestamp: row.updated_at,
      });
    }
  } catch (error) {
    log.error('Init failed:', error);
    // L'app fonctionne quand même — le cache mémoire reste vide,
    // et piconService résoudra via l'index statique.
  }
}

// ============================================================================
// PUBLIC API — Lecture (synchrone via mémoire)
// ============================================================================

/**
 * Récupère un picon depuis le cache mémoire (synchrone).
 *
 * @returns L'URL si trouvée et valide, null si vérifié mais absent, undefined si pas en cache
 */
export function getCachedPicon(channelNameNormalized: string): string | null | undefined {
  const entry = memoryCache.get(channelNameNormalized);
  if (!entry) return undefined;

  // Vérifier expiration
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    memoryCache.delete(channelNameNormalized);
    return undefined;
  }

  return entry.url;
}

// ============================================================================
// PUBLIC API — Écriture (mémoire immédiate + SQLite fire-and-forget)
// ============================================================================

/**
 * Enregistre un picon dans le cache.
 * Écriture synchrone en mémoire + async fire-and-forget vers SQLite.
 *
 * @param channelNameNormalized - Clé normalisée de la chaîne
 * @param url - URL du picon ou null si non trouvé
 */
export function cachePicon(channelNameNormalized: string, url: string | null): void {
  const now = Date.now();

  // 1. Mémoire — immédiat (pour résolution synchrone)
  memoryCache.set(channelNameNormalized, { url, timestamp: now });

  // 2. SQLite — fire-and-forget (pour persistance)
  void persistToSqlite(channelNameNormalized, url, now);
}

/** Persiste une entrée vers SQLite (non-bloquant). */
async function persistToSqlite(channelKey: string, url: string | null, timestamp: number): Promise<void> {
  try {
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO picon_cache (channel_key, url, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_key)
       DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`,
      [channelKey, url, timestamp]
    );
  } catch (error) {
    // Échec silencieux — le cache mémoire reste fonctionnel
    log.warn('SQLite persist failed:', error);
  }
}

// ============================================================================


