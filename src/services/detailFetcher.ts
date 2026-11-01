/**
 * Detail Fetcher Service
 *
 * Service pour récupérer les détails complets d'un item depuis SQLite.
 * Implémente un cache LRU en RAM pour les accès répétés.
 *
 * Usage:
 * - getMovieDetail(streamId) → IptvStream complet
 * - getSeriesDetail(seriesId) → IptvSeries complet
 * - getLiveDetail(streamId) → IptvStream complet
 */

import { getMovieById, toIptvStream } from './movieRepository';
import { getSeriesById, toIptvSeries } from './seriesRepository';
import type { IptvStream, IptvSeries } from '../types/iptv';
import { createLogger } from '../utils/logger';

const log = createLogger('DetailFetcher');

// ============================================================================
// DEV LOGGING
// ============================================================================
const isDev = import.meta.env?.DEV ?? false;

// ============================================================================
// LRU CACHE
// ============================================================================

const MAX_CACHE_SIZE = 50;

// Cache unifié avec préfixe type pour éviter collisions d'IDs
const detailCache = new Map<string, IptvStream | IptvSeries>();

/**
 * Ajoute un item au cache avec éviction LRU
 */
function addToCache(key: string, data: IptvStream | IptvSeries): void {
  // LRU: supprimer le plus ancien si cache plein
  if (detailCache.size >= MAX_CACHE_SIZE) {
    const firstKey = detailCache.keys().next().value;
    if (firstKey) {
      detailCache.delete(firstKey);
    }
  }
  detailCache.set(key, data);
}

/**
 * Récupère un item du cache et le "touche" pour LRU
 */
function getFromCache<T extends IptvStream | IptvSeries>(key: string): T | undefined {
  const item = detailCache.get(key);
  if (item) {
    // LRU touch: supprimer et remettre à la fin
    detailCache.delete(key);
    detailCache.set(key, item);
    return item as T;
  }
  return undefined;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Récupère les détails complets d'un film depuis SQLite
 * @param streamId - L'ID du stream (stream_id)
 * @returns Le film complet ou null si non trouvé
 */
export async function getMovieDetail(streamId: number): Promise<IptvStream | null> {
  const cacheKey = `movie:${streamId}`;

  // 1. Check cache
  const cached = getFromCache<IptvStream>(cacheKey);
  if (cached) {
    if (isDev) log.debug(`Cache hit: movie ${streamId}`);
    return cached;
  }

  // 2. Fetch from SQLite
  try {
    const entry = await getMovieById(streamId);
    if (!entry) {
      log.warn(`Movie ${streamId} not found in SQLite`);
      return null;
    }

    // 3. Build IptvStream using centralized mapper
    const data = toIptvStream(entry);

    addToCache(cacheKey, data);
    if (isDev) log.debug(`Loaded movie ${streamId} from SQLite`);
    return data;
  } catch (e) {
    log.error(`Error fetching movie ${streamId}:`, e);
    return null;
  }
}

/**
 * Récupère les détails complets d'une série depuis SQLite
 * @param seriesId - L'ID de la série (series_id)
 * @returns La série complète ou null si non trouvée
 */
export async function getSeriesDetail(seriesId: number): Promise<IptvSeries | null> {
  const cacheKey = `series:${seriesId}`;

  // 1. Check cache
  const cached = getFromCache<IptvSeries>(cacheKey);
  if (cached) {
    if (isDev) log.debug(`Cache hit: series ${seriesId}`);
    return cached;
  }

  // 2. Fetch from SQLite
  try {
    const entry = await getSeriesById(seriesId);
    if (!entry) {
      log.warn(`Series ${seriesId} not found in SQLite`);
      return null;
    }

    // 3. Build IptvSeries using centralized mapper
    const data = toIptvSeries(entry);

    addToCache(cacheKey, data);
    if (isDev) log.debug(`Loaded series ${seriesId} from SQLite`);
    return data;
  } catch (e) {
    log.error(`Error fetching series ${seriesId}:`, e);
    return null;
  }
}

/**
 * Vide le cache (utile pour les tests ou le refresh)
 */
export function clearDetailCache(): void {
  detailCache.clear();
}

/**
 * Retourne les stats du cache (pour debug)
 */
export function getDetailCacheStats(): { size: number; maxSize: number } {
  return {
    size: detailCache.size,
    maxSize: MAX_CACHE_SIZE,
  };
}
