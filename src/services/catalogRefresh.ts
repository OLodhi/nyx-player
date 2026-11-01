/**
 * catalogRefresh.ts — Appel de l'actualisation par comparaison (Rust, `catalog_refresh.rs`).
 *
 * Contrairement à `ingestCatalog` (connexion, bouton « Actualiser »), elle traite une liste à la
 * fois, n'écrit que les différences et peut s'arrêter à tout moment (vidéo lancée, déconnexion).
 * Les identifiants ne sont jamais journalisés.
 */

import { invoke } from '@tauri-apps/api/core';
import type { XtreamCredentials } from '../types/iptv';
import { getDnsProvider } from './preferencesService';

export type CatalogListName = 'categories' | 'movies' | 'series' | 'live';

export type RefreshStatus = 'done' | 'unchanged' | 'partial' | 'failed' | 'aborted' | 'busy' | 'rate_limited';

export interface RefreshListSummary {
  list: CatalogListName;
  outcome: 'applied' | 'unchanged' | 'kept' | 'failed' | 'not_run';
  added: number;
  changed: number;
  moved: number;
  removed: number;
  newItems: number;
  removalSkipped: boolean;
  skippedItems: number;
}

export interface RefreshSummary {
  status: RefreshStatus;
  /** Pour `aborted` : arrêt demandé par la page, ou fournisseur changé entre-temps */
  stopReason: 'page' | 'provider_changed' | null;
  retryAfterSec: number | null;
  lists: RefreshListSummary[];
  /** Listes à retenter seules au prochain passage */
  failedLists: CatalogListName[];
  /** Reprises de films re-liées à un nouveau numéro (même TMDB), à reporter dans le cloud */
  progressRelinks: { from: number; to: number }[];
  epgRelinked: number;
  durationMs: number;
  bytesDownloaded: number;
}

let lastRunId = 0;

/**
 * Numéro de passage, toujours croissant (même après un rechargement de la page) : un arrêt demandé
 * pour un passage vaut aussi pour les précédents, jamais pour les suivants.
 */
export function nextRefreshRunId(): number {
  lastRunId = Math.max(lastRunId + 1, Date.now());
  return lastRunId;
}

export function refreshCatalogDiff(
  runId: number,
  creds: XtreamCredentials,
  dbName: string,
  lists?: CatalogListName[],
  mode: 'auto' | 'manual' = 'auto',
): Promise<RefreshSummary> {
  return invoke<RefreshSummary>('refresh_catalog', {
    runId,
    host: creds.host,
    username: creds.username,
    password: creds.password,
    dbName,
    dnsProvider: getDnsProvider(),
    lists: lists && lists.length > 0 ? lists : null,
    mode,
  });
}

/** Demande l'arrêt du passage `runId` (retenu même s'il n'a pas encore commencé) */
export function abortCatalogRefresh(runId: number): Promise<void> {
  return invoke<void>('abort_catalog_refresh', { runId });
}
