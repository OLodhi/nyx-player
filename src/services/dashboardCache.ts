/**
 * dashboardCache.ts — Rangées de l'accueil gardées en mémoire, et leur remise à jour après une
 * actualisation du catalogue.
 *
 * L'accueil garde ses rangées (bannière, tendances, carrousels, genres) dans ce module pour
 * s'afficher tout de suite quand on y revient. Chaque rangée pointe vers des numéros du catalogue
 * (stream_id, series_id) : quand le catalogue change, elle doit être rapprochée à nouveau du
 * catalogue neuf, sinon l'accueil montre l'ancien contenu (nouveautés absentes, carte qui n'ouvre
 * rien ou le mauvais film).
 *
 * Remise à jour en deux temps, pour qu'un rafraîchissement en arrière-plan puisse préparer le
 * calcul à l'avance et l'installer à un moment calme :
 *   1. `computeDashboardRematch(catalogue)` (dashboardRematch.ts), asynchrone, n'affiche rien ;
 *   2. `installDashboardRematch(résultat)` (ici), synchrone, écrit le cache et prévient l'accueil.
 * L'accueil ne passe jamais par l'état « chargement » pendant ce recalcul.
 *
 * Ce module reste léger (aucune dépendance TMDB ni i18n) : la déconnexion Supabase peut le vider.
 */

import type { HeroMovie } from '../types/dashboard';
import type { LightIndexes } from '../types/lightIndex';
import type { TrendingItem } from './tmdbMatchingService';
import { devLog } from '../utils/devLog';

/** Nombre d'éléments par rangée et de films dans la bannière (mêmes valeurs que l'accueil) */
export const DASHBOARD_ROW_LIMIT = 20;
export const DASHBOARD_HERO_COUNT = 5;

/**
 * Numéro d'identité d'une table du catalogue (films, séries). Le cache ne garde que ce numéro, et
 * jamais la table elle-même : sinon il garderait en vie l'ancien catalogue entier (dizaines de Mo
 * sur un gros fournisseur) après chaque actualisation ou mise à jour du guide.
 */
const tableIds = new WeakMap<object, number>();
let nextTableId = 1;

export function catalogTableId(table: object): number {
  let id = tableIds.get(table);
  if (id === undefined) {
    id = nextTableId++;
    tableIds.set(table, id);
  }
  return id;
}

/** Catalogue et langue pour lesquels les rangées de base ont été calculées */
export interface DashboardBaseKey {
  moviesId: number;
  seriesId: number;
  lang: string;
}

/** Clé complète du dernier calcul des rangées « genres » */
export interface DashboardGenreKey {
  moviesId: number;
  genresKey: string;
  lang: string;
}

/** Clé des rangées de base pour un catalogue et une langue */
export function baseKeyFor(indexes: LightIndexes, lang: string): DashboardBaseKey {
  return { moviesId: catalogTableId(indexes.movies), seriesId: catalogTableId(indexes.series), lang };
}

/** Clé des rangées « genres » pour un catalogue, des genres choisis et une langue */
export function genreKeyFor(indexes: LightIndexes, genresKey: string, lang: string): DashboardGenreKey {
  return { moviesId: catalogTableId(indexes.movies), genresKey, lang };
}

/** Vrai si les rangées de base ont été calculées pour ce catalogue */
export function sameBaseCatalog(key: DashboardBaseKey, indexes: LightIndexes): boolean {
  return key.moviesId === catalogTableId(indexes.movies) && key.seriesId === catalogTableId(indexes.series);
}

export interface DashboardBaseRows {
  heroMovies: HeroMovie[];
  trending: TrendingItem[];
  nowPlaying: TrendingItem[];
  onTheAir: TrendingItem[];
  topRated: TrendingItem[];
  popular: TrendingItem[];
}

// =============================================================================
// CACHE DU MODULE — affichage immédiat au retour sur l'accueil (≈ 78 Ko au plus)
// Persiste entre les montages de l'accueil ; remplacé (jamais cumulé) à chaque calcul.
// =============================================================================
export const dashboardCache = {
  hasData: false,
  heroMovies: [] as HeroMovie[],
  trending: [] as TrendingItem[],
  nowPlaying: [] as TrendingItem[],
  onTheAir: [] as TrendingItem[],
  topRated: [] as TrendingItem[],
  popular: [] as TrendingItem[],
  genreCarousels: new Map<number, TrendingItem[]>(),
  /** Pour quel catalogue et quelle langue les rangées de base ont été calculées */
  baseFor: null as DashboardBaseKey | null,
  /** Pour quel catalogue, quels genres et quelle langue les rangées « genres » ont été calculées */
  genreFor: null as DashboardGenreKey | null,
};

/** Augmente à chaque vidage : un recalcul commencé avant un vidage n'est pas installé. */
let cacheGeneration = 0;

/** Vrai après un vidage explicite (changement de langue), faux au démarrage à froid */
let dashboardCacheWasReset = false;

const listeners = new Set<() => void>();

/** Vrai si l'accueil se recharge après un changement de langue (et non au démarrage à froid) */
export function isDashboardReloading(): boolean {
  return dashboardCacheWasReset;
}

/** Marque la fin d'un chargement complet (l'accueil n'est plus « en rechargement ») */
export function markDashboardLoaded(): void {
  dashboardCacheWasReset = false;
}

/** Numéro de génération courant du cache (pour ignorer un calcul commencé avant un vidage) */
export function getDashboardCacheGeneration(): number {
  return cacheGeneration;
}

/**
 * Vide les rangées sans marquer l'accueil « en rechargement » : déconnexion, connexion à une
 * source, remise à zéro. L'accueil suivant se charge comme au premier lancement.
 */
export function clearDashboardCache(): void {
  cacheGeneration++;
  dashboardCache.hasData = false;
  dashboardCache.heroMovies = [];
  dashboardCache.trending = [];
  dashboardCache.nowPlaying = [];
  dashboardCache.onTheAir = [];
  dashboardCache.topRated = [];
  dashboardCache.popular = [];
  dashboardCache.genreCarousels = new Map();
  dashboardCache.baseFor = null;
  dashboardCache.genreFor = null;
}

/** Vide les rangées avant un rechargement complet (changement de langue, outils de debug) */
export function resetDashboardCache(): void {
  dashboardCacheWasReset = true;
  clearDashboardCache();
}

/** L'accueil affiché s'abonne ici pour recevoir les rangées installées. */
export function subscribeDashboardCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface DashboardRematch {
  generation: number;
  base: { rows: DashboardBaseRows; key: DashboardBaseKey } | null;
  genres: { carousels: Map<number, TrendingItem[]>; key: DashboardGenreKey } | null;
}

/** Même contenu affiché (numéros, images, titres) : on garde l'ancien tableau, pas de rendu inutile */
function sameRow<T extends { id: string | number; tmdbId?: number; title: string }>(
  a: readonly T[],
  b: readonly T[],
  image: (item: T) => string | undefined,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].tmdbId !== b[i].tmdbId || a[i].title !== b[i].title) return false;
    if (image(a[i]) !== image(b[i])) return false;
  }
  return true;
}

const itemImage = (item: TrendingItem) => item.image;
const heroImage = (hero: HeroMovie) => `${hero.backdropUrl}|${hero.logoUrl ?? ''}`;

function keepIfSame<T extends { id: string | number; tmdbId?: number; title: string }>(
  previous: T[],
  next: T[],
  image: (item: T) => string | undefined,
): T[] {
  return sameRow(previous, next, image) ? previous : next;
}

/**
 * Installe des rangées préparées par `computeDashboardRematch`. Synchrone : à appeler dans le
 * même geste que `setLightIndexes(catalogue)`, pour que React affiche les deux ensemble.
 * Ignoré si le cache a été vidé depuis le début du calcul (déconnexion, changement de langue).
 * Renvoie vrai si quelque chose a été installé.
 */
export function installDashboardRematch(rematch: DashboardRematch): boolean {
  if (rematch.generation !== cacheGeneration) {
    devLog('data', '[Dashboard] Recalcul ignoré : le cache a été vidé entre-temps');
    return false;
  }
  if (!rematch.base && !rematch.genres) return false;

  if (rematch.base) {
    const { rows, key } = rematch.base;
    dashboardCache.heroMovies = keepIfSame(dashboardCache.heroMovies, rows.heroMovies, heroImage);
    dashboardCache.trending = keepIfSame(dashboardCache.trending, rows.trending, itemImage);
    dashboardCache.nowPlaying = keepIfSame(dashboardCache.nowPlaying, rows.nowPlaying, itemImage);
    dashboardCache.onTheAir = keepIfSame(dashboardCache.onTheAir, rows.onTheAir, itemImage);
    dashboardCache.topRated = keepIfSame(dashboardCache.topRated, rows.topRated, itemImage);
    dashboardCache.popular = keepIfSame(dashboardCache.popular, rows.popular, itemImage);
    dashboardCache.hasData = true;
    dashboardCache.baseFor = key;
  }

  if (rematch.genres) {
    const { carousels, key } = rematch.genres;
    const previous = dashboardCache.genreCarousels;
    let changed = previous.size !== carousels.size;
    const merged = new Map<number, TrendingItem[]>();
    for (const [genreId, row] of carousels) {
      const kept = keepIfSame(previous.get(genreId) ?? [], row, itemImage);
      if (kept !== previous.get(genreId)) changed = true;
      merged.set(genreId, kept);
    }
    if (changed) dashboardCache.genreCarousels = merged;
    dashboardCache.genreFor = key;
  }

  for (const listener of listeners) listener();
  return true;
}
