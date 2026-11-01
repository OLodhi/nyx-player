/**
 * catalogIngestion.ts — Ingestion du catalogue IPTV via Rust
 *
 * Responsabilités :
 * - Appeler le backend Rust pour ingérer le catalogue Xtream
 * - Faire suivre le cloud quand des reprises de films ont été re-liées à un nouveau numéro
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { pushRelinkedProgress, type ProgressRelink } from './progressRelink';
import { getDatabaseFileName } from './dbCore';
import { PLAYBACK_EVENT } from './eventConstants';
import { getDnsProvider } from './preferencesService';
import { createLogger } from '../utils/logger';

const log = createLogger('CatalogIngestion');

// ============================================================================
// TYPES
// ============================================================================

/**
 * Résultat de l'ingestion du catalogue
 */
interface IngestResult {
  movies_count: number;
  series_count: number;
  live_count: number;
  categories_count: number;
  duration_ms: number;
  /** True si au moins un endpoint a échoué */
  partial: boolean;
  /** Liste des endpoints qui ont échoué (ex: ["series", "live_categories"]) */
  failed_endpoints: string[];
  /** Parmi elles, les listes refusées car anormalement grosses (une liste ou le catalogue entier au-delà de sa borne) */
  too_large_endpoints?: string[];
  /** Logs d'ingestion pour affichage console F12 */
  logs: string[];
  /**
   * Reprises de films re-liées par le Rust au film de même numéro TMDB, seulement quand la liste
   * des films a été reçue en entier. Aucune reprise n'est jamais effacée par une lecture du
   * catalogue.
   */
  progress_relinks?: ProgressRelink[];
}

/** Payload des events `ingest-progress` émis par Rust */
interface IngestProgressEvent {
  /** Phase en cours : "fetch", "sqlite", "done" */
  phase?: string;
  /** Endpoint concerné : "movies", "series", "live", etc. */
  endpoint?: string;
  /** Statut : "started", "done", "failed", "complete", "partial" */
  status: string;
  /** Nombre d'items téléchargés (si done) */
  count?: number;
  /** Erreur (si failed) */
  error?: string;
  /** Durée totale en ms (si phase=done) */
  durationMs?: number;
}

// ============================================================================
// INGESTION
// ============================================================================

/** Recalcul des liens du guide lancé par la dernière lecture du catalogue : vrai s'il a abouti */
let lastEpgRemap: Promise<boolean> = Promise.resolve(false);

/**
 * Fin du recalcul des liens du guide lancé par la dernière lecture du catalogue (jamais d'erreur ;
 * faux si aucun n'a été lancé ou s'il a échoué). La lecture réécrit les chaînes sans leurs liens au
 * guide, et le recalcul tourne ensuite en arrière-plan : le catalogue relu entre les deux n'en a
 * aucun, et Live TV restait sans programmes jusqu'au redémarrage.
 */
export function whenEpgLinksReady(): Promise<boolean> {
  return lastEpgRemap;
}

/**
 * Arrête le chargement du catalogue en cours côté Rust (déconnexion) : sans cela, le téléchargement
 * continuait jusqu'au bout après la déconnexion. Sans effet si rien n'est en cours.
 */
export async function cancelCatalogIngestion(): Promise<void> {
  try {
    await invoke('cancel_catalog_ingestion');
  } catch (e) {
    log.warn('cancel failed:', e);
  }
}

/**
 * Ingère le catalogue IPTV depuis l'API Xtream directement dans SQLite.
 * Remplace le flux JS fetch/parse/insert par Rust natif.
 * 
 * ## Phases internes (Rust)
 * 1. Fetch 6 endpoints en parallèle (tokio::join!)
 * 2. Parse JSON avec serde
 * 3. Insert SQLite batch (transaction unique)
 * 
 * @param host - URL du serveur Xtream (ex: http://provider.com:8080)
 * @param username - Nom d'utilisateur Xtream
 * @param password - Mot de passe Xtream
 * @param onProgress - Callback optionnel pour le feedback de progression
 * @param isStillCurrent - Faux dès que la session a changé (compte, déconnexion) : plus rien n'est
 *   envoyé au cloud ; la base lue est vérifiée en plus
 * @returns IngestResult avec compteurs et durée
 */
export async function ingestCatalog(
  host: string,
  username: string,
  password: string,
  onProgress?: (event: IngestProgressEvent) => void,
  isStillCurrent: () => boolean = () => true,
): Promise<IngestResult> {
  // Écouter les events de progression si callback fourni
  let unlisten: UnlistenFn | null = null;
  if (onProgress) {
    unlisten = await listen<IngestProgressEvent>('ingest-progress', (e) => {
      onProgress(e.payload);
    });
  }

  // Plus de recalcul des liens d'une lecture précédente : seule celle-ci en lance un
  lastEpgRemap = Promise.resolve(false);
  // Base de ce compte, prise au départ : la lecture dure longtemps et le compte peut changer entre-temps
  const dbName = getDatabaseFileName();
  try {
    const result = await invoke<IngestResult>('ingest_catalog', {
      host,
      username,
      password,
      dbName,
      dnsProvider: getDnsProvider(),
    });

    // Déconnexion ou autre compte pendant la lecture : la base ouverte n'est plus celle du catalogue
    // lu, rien n'y est nettoyé ni relié
    if (getDatabaseFileName() !== dbName) {
      log.warn('Session changed during ingestion, post-ingest steps skipped');
      return result;
    }

    // Reprises re-liées à un nouveau numéro : le cloud suit, et « Reprendre » se relit
    const relinks = result.progress_relinks ?? [];
    if (relinks.length > 0) {
      try {
        await pushRelinkedProgress(relinks, () => getDatabaseFileName() === dbName && isStillCurrent());
      } catch (e) {
        log.warn('relinked progress not sent to the cloud:', e);
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PLAYBACK_EVENT));
    }

    // Trigger background EPG mapping silently (fire and forget) to restore XMLTV links
    // without blocking the ingestion promise or user interface. Sa fin est gardée : le catalogue relu
    // juste après la lecture n'a encore aucun lien au guide (whenEpgLinksReady).
    lastEpgRemap = invoke('remap_epg', { dbName }).then(
      () => true,
      (e) => {
        log.warn('Background EPG mapping failed:', e);
        return false;
      },
    );

    return result;
  } finally {
    // Toujours nettoyer le listener, même en cas d'erreur
    if (unlisten) unlisten();
  }
}
