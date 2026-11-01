/**
 * Renouvellement de la session Supabase : ne se déconnecter que sur un vrai refus du serveur.
 *
 * Au lancement, après plus d'une heure sans ouvrir l'app, Supabase renouvelle la session avec le
 * jeton de renouvellement enregistré. S'il n'obtient pas de réseau, ou une erreur 5xx connue, il garde
 * la session et réessaie. Mais toute autre réponse en erreur efface la session (« Votre session a
 * expiré »), même quand elle ne vient pas du serveur d'authentification : page HTML d'un portail
 * Wi-Fi ou d'un proxy, blocage temporaire de Cloudflare (403, 429), limite de requêtes. Le jeton de
 * renouvellement était pourtant encore bon.
 *
 * Ici, une réponse en erreur au renouvellement n'est transmise telle quelle à Supabase que si c'est
 * un refus définitif du serveur d'authentification : statut 400, 401, 403 ou 404 avec un code
 * d'erreur Supabase (`refresh_token_not_found`, `refresh_token_already_used`, `session_not_found`...).
 * Le reste passe pour une panne réseau : session gardée, nouvel essai au renouvellement suivant
 * (signalé une fois par lancement à Sentry, pour qu'un blocage durable ne passe pas inaperçu).
 *
 * Chaque échec est aussi noté (statut et code, jamais le jeton) : quand une session est perdue,
 * authSessionWatch.ts dit pourquoi dans le journal et dans Sentry. Sur un refus définitif, on note
 * aussi depuis combien d'heures la session enregistrée n'avait pas été renouvelée : un jeton
 * « introuvable » renouvelé récemment désigne une session fermée ailleurs (déconnexion de tous les
 * appareils), un jeton vieux de plus d'un jour plutôt un renouvellement perdu.
 */

import * as Sentry from '@sentry/react';
import { createLogger } from '../utils/logger';

const log = createLogger('auth');

/** Refus que Supabase traite comme la fin de la session. */
const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404]);

/** Un échec plus ancien n'explique pas la déconnexion en cours. */
const FAILURE_MEMORY_MS = 60_000;

export interface RefreshFailure {
  /** Statut HTTP de la réponse. */
  status: number;
  /** Code d'erreur Supabase, ou null quand la réponse ne vient pas du serveur d'authentification. */
  code: string | null;
  /** Vrai quand la réponse a été transmise à Supabase comme un refus (session effacée). */
  definitive: boolean;
  /** Refus définitif : heures depuis le dernier renouvellement de la session refusée, null si inconnu. */
  sessionAgeHours?: number | null;
  at: number;
}

export interface AuthGuardOptions {
  /** Lit la session enregistrée (JSON de Supabase), encore présente au moment du refus. */
  readStoredSession?: () => Promise<string | null>;
}

/** La lecture de la session ne doit jamais retarder longtemps la réponse rendue à Supabase. */
const SESSION_READ_TIMEOUT_MS = 2_000;

/** Heures écoulées depuis le renouvellement de la session enregistrée (`expires_at` − `expires_in`). */
async function storedSessionAgeHours(read: () => Promise<string | null>): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([
      read(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), SESSION_READ_TIMEOUT_MS); }),
    ]);
    if (!raw) return null;
    const { expires_at: expiresAt, expires_in: expiresIn } = JSON.parse(raw) as { expires_at?: unknown; expires_in?: unknown };
    if (typeof expiresAt !== 'number' || typeof expiresIn !== 'number') return null;
    return Math.max(0, Math.round((Date.now() / 1000 - (expiresAt - expiresIn)) / 3600));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let lastFailure: RefreshFailure | null = null;
/** Une réponse inattendue n'est signalée à Sentry qu'une fois par lancement (elle se répète à chaque essai). */
let unexpectedReported = false;

function isRefreshRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.includes('/token?grant_type=refresh_token');
}

/** Code d'erreur du serveur d'authentification (`code`, ou `error_code` des anciennes versions). */
async function authErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== 'object' || body === null) return null;
    const { code, error_code: errorCode } = body as { code?: unknown; error_code?: unknown };
    if (typeof code === 'string') return code;
    if (typeof errorCode === 'string') return errorCode;
    return null;
  } catch {
    return null; // HTML, texte, corps vide : pas une réponse du serveur d'authentification
  }
}

/** `fetch` donné au client Supabase (option `global.fetch`). Seul le renouvellement est surveillé. */
export function createAuthGuardedFetch(
  baseFetch: typeof fetch = (...args) => fetch(...args),
  { readStoredSession }: AuthGuardOptions = {},
): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!isRefreshRequest(input)) return response;
    if (response.ok) {
      lastFailure = null;
      return response;
    }

    const code = await authErrorCode(response);
    const definitive = code !== null && DEFINITIVE_STATUSES.has(response.status);
    lastFailure = { status: response.status, code, definitive, at: Date.now() };
    if (definitive) {
      // Lue avant de rendre la réponse : Supabase efface la session juste après. C'est l'âge de la
      // session enregistrée (le jeton refusé en vient, l'app ne renouvelle jamais un jeton venu d'ailleurs)
      if (readStoredSession) lastFailure.sessionAgeHours = await storedSessionAgeHours(readStoredSession);
      return response;
    }

    // Gardée, la session n'apparaît jamais comme perdue : sans ce signal, un refus durable que l'app ne
    // reconnaît pas (clé du projet refusée, code inconnu) passerait inaperçu. Les pannes du serveur
    // (5xx), déjà traitées ainsi par Supabase, ne sont pas signalées : chaque appareil le ferait
    if (!unexpectedReported && response.status < 500) {
      unexpectedReported = true;
      Sentry.captureMessage('Renouvellement de session : réponse inattendue, session gardée', {
        level: 'warning',
        tags: { auth_refresh_status: String(response.status), auth_refresh_code: code ?? 'aucun' },
      });
    }
    log.warn(`Renouvellement de session sans réponse claire (HTTP ${response.status}${code ? `, ${code}` : ''}) : session gardée, nouvel essai plus tard`);
    // Même traitement qu'une coupure réseau : Supabase garde la session
    throw new TypeError(`Renouvellement de session : réponse inattendue (HTTP ${response.status})`);
  };
}

/** Dernier échec de renouvellement, s'il est assez récent pour expliquer une déconnexion. */
export function recentRefreshFailure(now: number = Date.now()): RefreshFailure | null {
  return lastFailure && now - lastFailure.at <= FAILURE_MEMORY_MS ? lastFailure : null;
}

/** Tests uniquement. */
export function resetAuthRefreshGuard(): void {
  lastFailure = null;
  unexpectedReported = false;
}
