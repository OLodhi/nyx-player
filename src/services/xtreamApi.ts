/**
 * Xtream Codes API Service
 *
 * Client pour l'API Xtream Codes (IPTV providers).
 *
 * ANTI-HALLUCINATION:
 * ⚠️ Créer une NOUVELLE instance à chaque utilisation: `new XtreamApiService(creds)`.
 * ⚠️ Les credentials viennent de StorageService.getCredentials().
 * ⚠️ getVodStreams/getSeries normalisent AUTOMATIQUEMENT les TMDB IDs (via normalizeTmdbId).
 * ⚠️ getSeriesInfo() retourne épisodes + info Xtream, PAS les détails TMDB.
 * ⚠️ Les URLs de stream sont construites par getStreamUrl() - ne pas hardcoder.
 */

import type { XtreamCredentials, IptvCategory, IptvStream, IptvSeries } from '../types/iptv';
import type { XtreamAuthResponse, XtreamSeriesInfo, XtreamVodInfo } from '../types/xtream';
import { iptvFetch, isProviderHttpServerError } from './networkService';
import { normalizeTmdbId } from '../utils/normalizeTmdb';
import { sanitizeIptvUrl } from '../utils/sanitizeUrl';
import { encodeXtreamPathSegment, safeContainerExtension } from '../utils/xtreamCredentials';
import { getCachedXtreamSeries, setCachedXtreamSeries } from './xtreamSeriesCache';
import { createLogger } from '../utils/logger';

const log = createLogger('XtreamApi');
const streamUrlLog = createLogger('XtreamApi.getStreamUrl');

/** Au moins un épisode dans la réponse `get_series_info` */
function hasEpisodes(info: XtreamSeriesInfo): boolean {
  const episodes = info.episodes;
  if (!episodes || typeof episodes !== 'object') return false;
  return Object.values(episodes).some((season) => Array.isArray(season) && season.length > 0);
}

/** Message de l'erreur levée quand le fournisseur refuse l'identifiant ou le mot de passe. */
const CREDENTIALS_REJECTED = 'Authentication failed';

/**
 * Vrai si l'erreur dit que le fournisseur a refusé l'identifiant ou le mot de passe (`authenticate`),
 * y compris un refus rendu par une erreur 5xx : Réglages > Sources le dit clairement.
 */
export function isCredentialsRejectedError(error: unknown): boolean {
  return error instanceof Error && error.message === CREDENTIALS_REJECTED;
}

/**
 * Le fournisseur répond par une page web (maintenance, protection Cloudflare) au lieu des
 * informations du compte. On ne peut pas savoir si les identifiants sont bons : certains panneaux
 * refusent aussi un mauvais mot de passe par une page HTML. Le message dit les deux, au lieu de
 * « vérifiez vos identifiants » seul. Un corps vide reste un refus des identifiants (réponse
 * habituelle d'un panneau à un mauvais mot de passe).
 */
const PROVIDER_HTML_RESPONSE = 'provider_html_response';

export function isProviderHtmlResponseError(error: unknown): boolean {
  return error instanceof Error && error.message === PROVIDER_HTML_RESPONSE;
}

/** Vrai si la réponse est une page web plutôt que du JSON */
function looksLikeHtml(text: string): boolean {
  return /^\s*</.test(text);
}

export class XtreamApiService {
  private host: string;
  private username: string;
  private password: string;

  constructor(creds: XtreamCredentials) {
    this.host = creds.host.endsWith('/') ? creds.host.slice(0, -1) : creds.host;
    this.username = creds.username;
    this.password = creds.password;
  }

  private getBaseUrl(): string {
    return `${this.host}/player_api.php?username=${encodeURIComponent(this.username)}&password=${encodeURIComponent(this.password)}`;
  }

  getStreamUrl(type: 'live' | 'movie' | 'series', id: string | number, extension?: string): string {
    // ⚠️ Log quand le fallback extension est déclenché pour VOD
    if (!extension && type !== 'live' && import.meta.env.DEV) {
      streamUrlLog.warn(`No extension for ${type}/${id} — defaulting to mp4`);
    }
    const ext = safeContainerExtension(extension) ?? (type === 'live' ? 'ts' : 'mp4');
    return `${this.host}/${type}/${encodeXtreamPathSegment(this.username)}/${encodeXtreamPathSegment(this.password)}/${id}.${ext}`;
  }

  /**
   * Masque les identifiants dans un texte à journaliser : formes Xtream connues, puis valeurs
   * exactes de ce compte (couvre les réponses où elles apparaissent sous une autre forme).
   */
  private maskForLog(text: string): string {
    let masked = sanitizeIptvUrl(text);
    // Forme brute puis formes encodées dans les adresses
    const secrets = new Set<string>();
    for (const secret of [this.password, this.username]) {
      if (!secret) continue;
      secrets.add(secret);
      secrets.add(encodeURIComponent(secret));
      secrets.add(encodeXtreamPathSegment(secret));
    }
    for (const secret of secrets) {
      masked = masked.split(secret).join('***');
    }
    return masked;
  }

  // Use Tauri backend to bypass CORS
  private async safeFetch<T = unknown>(url: string): Promise<T | null> {
    return this.parseJson<T>(await iptvFetch(url));
  }

  /** Réponse lue en JSON ; vide ou illisible : null (rien n'est levé) */
  private parseJson<T>(result: string | null | undefined): T | null {
    // Handle empty or invalid responses
    if (!result || result.trim() === '') {
      return null;
    }
    try {
      return JSON.parse(result) as T;
    } catch {
      // Masquer AVANT de tronquer : une coupure au milieu de `"password":"…` empêcherait le masquage.
      // Fenêtre de 2000 caractères : une réponse coupée peut peser des Mo ; tout ce qui entre dans les 100 premiers y tient.
      log.warn('Invalid JSON response:', this.maskForLog(result.slice(0, 2000)).substring(0, 100));
      return null;
    }
  }

  async authenticate(): Promise<XtreamAuthResponse> {
    let data: XtreamAuthResponse | null;
    try {
      const raw = await iptvFetch(this.getBaseUrl());
      if (raw && looksLikeHtml(raw)) {
        log.warn('Page web reçue au lieu des informations du compte (maintenance du fournisseur ?)');
        throw new Error(PROVIDER_HTML_RESPONSE);
      }
      data = this.parseJson<XtreamAuthResponse>(raw);
    } catch (error) {
      if (isProviderHtmlResponseError(error)) throw error;
      // Certains fournisseurs refusent un mauvais mot de passe par une erreur 5xx : si leur
      // serveur répond normalement sans identifiants, il est en marche et ce sont eux qui sont refusés.
      if (isProviderHttpServerError(error) && (await this.serverAnswersWithoutCredentials())) {
        throw new Error(CREDENTIALS_REJECTED);
      }
      throw error;
    }
    if (!data?.user_info || data.user_info.auth === 0) {
      throw new Error(CREDENTIALS_REJECTED);
    }
    return data;
  }

  /** Vrai si la racine du serveur répond sans erreur 5xx ni panne réseau (aucun identifiant envoyé). */
  private async serverAnswersWithoutCredentials(): Promise<boolean> {
    try {
      await iptvFetch(`${this.host}/`);
      return true;
    } catch {
      return false;
    }
  }

  async getCategories(
    action: 'get_live_categories' | 'get_vod_categories' | 'get_series_categories'
  ): Promise<IptvCategory[]> {
    const data = await this.safeFetch(`${this.getBaseUrl()}&action=${action}`);
    return Array.isArray(data) ? data : [];
  }

  async getLiveStreams(): Promise<IptvStream[]> {
    const data = await this.safeFetch(`${this.getBaseUrl()}&action=get_live_streams`);
    return Array.isArray(data) ? data : [];
  }

  /**
   * Get VOD streams (movies) with normalized TMDB IDs.
   * ⚠️ ATTENTION: La normalisation TmdbId se fait ICI, à la réception.
   * Ne jamais re-normaliser ailleurs dans le code.
   */
  async getVodStreams(): Promise<IptvStream[]> {
    const data = await this.safeFetch<unknown[]>(`${this.getBaseUrl()}&action=get_vod_streams`);
    if (!Array.isArray(data)) return [];

    // Normaliser le champ tmdb à la réception
    return data.map((item) => {
      const stream = item as IptvStream;
      return {
        ...stream,
        tmdb: normalizeTmdbId((stream as { tmdb?: unknown }).tmdb),
      };
    });
  }

  /**
   * Get series list with normalized TMDB IDs.
   * ⚠️ ATTENTION: La normalisation TmdbId se fait ICI, à la réception.
   * Ne jamais re-normaliser ailleurs dans le code.
   */
  async getSeries(): Promise<IptvSeries[]> {
    const data = await this.safeFetch<unknown[]>(`${this.getBaseUrl()}&action=get_series`);
    if (!Array.isArray(data)) return [];

    // Normaliser le champ tmdb à la réception
    return data.map((item) => {
      const series = item as IptvSeries;
      return {
        ...series,
        tmdb: normalizeTmdbId((series as { tmdb?: unknown }).tmdb),
      };
    });
  }

  async getSeriesInfo(seriesId: number | string): Promise<XtreamSeriesInfo | null> {
    // Check SQLite cache first (Phase C3)
    const cached = await getCachedXtreamSeries<XtreamSeriesInfo>(Number(seriesId));
    if (cached) {
      return cached;
    }

    // Fetch from API
    const data = await this.safeFetch<XtreamSeriesInfo>(
      `${this.getBaseUrl()}&action=get_series_info&series_id=${seriesId}`
    );

    // Mise en cache 24 h seulement si la série a des épisodes : une réponse vide (erreur passagère
    // du fournisseur) laissait la fiche vide pendant 24 h. Elle est redemandée ensuite.
    if (data && hasEpisodes(data)) {
      await setCachedXtreamSeries(Number(seriesId), data);
    }

    return data;
  }

  /**
   * Get VOD info - may contain tmdb_id if provider configured it
   */
  async getVodInfo(vodId: number | string): Promise<XtreamVodInfo | null> {
    return await this.safeFetch<XtreamVodInfo>(
      `${this.getBaseUrl()}&action=get_vod_info&vod_id=${vodId}`
    );
  }

  async *fetchMassiveData(
    action: string,
    onProgress?: (percent: number) => void
  ): AsyncGenerator<unknown[]> {
    onProgress?.(0);
    const data = await this.safeFetch<unknown[]>(`${this.getBaseUrl()}&action=${action}`);
    onProgress?.(100);

    if (!Array.isArray(data)) return;

    const chunkSize = 5000;
    for (let i = 0; i < data.length; i += chunkSize) {
      yield data.slice(i, i + chunkSize);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}
