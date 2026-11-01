/**
 * Heure du serveur Supabase, pour dater ce que la synchro compare.
 *
 * La synchro règle les conflits par « la modification la plus récente gagne » (`updated_at`). Datées
 * avec l'horloge de l'appareil, les modifications d'une box réglée dans le futur gagnaient tous les
 * conflits, et celles d'une box en retard les perdaient tous. L'app apprend ici l'écart entre son
 * horloge et celle du serveur, et `serverNow()` donne l'heure du serveur : Date.now() + écart.
 *
 * Deux sources, lues au passage sur les réponses de Supabase (fetch donné au client, supabaseClient.ts),
 * sans aucune requête ni fonction nouvelle côté base :
 * - le jeton d'accès d'une réponse du serveur d'authentification (`/auth/v1/token` : connexion,
 *   renouvellement) : son champ `iat` est l'heure du serveur à l'émission. Le corps d'une réponse est
 *   toujours lisible, c'est la source sûre. Le renouvellement a lieu au lancement dès que la session
 *   a plus d'une heure, puis toutes les heures environ ;
 * - l'en-tête HTTP `Date`, quand le WebView le laisse lire. En CORS, `Date` ne fait pas partie des
 *   en-têtes lisibles par défaut (Cache-Control, Content-Language, Content-Length, Content-Type,
 *   Expires, Last-Modified, Pragma) : il ne l'est que si le serveur le liste dans
 *   `Access-Control-Expose-Headers`, ce qui ne se vérifie pas sans réseau. Lu quand il est là
 *   (`headers.get` rend null sinon), jamais nécessaire.
 *
 * Un écart n'est retenu que s'il est plausible (moins d'un an). Les mesures suivantes le lissent ;
 * un saut de plus d'une minute (horloge changée entre-temps) le remplace, seulement s'il vient d'un
 * jeton : un en-tête `Date` peut être ancien (réponse gardée en cache) et ne fait que lisser. Sans écart connu,
 * `serverNow()` rend Date.now(), comme avant. L'écart reste en mémoire : une horloge corrigée entre
 * deux lancements ne garde pas un ancien écart.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('sync');

/** Un écart plus grand n'est pas une horloge fausse mais une réponse aberrante. */
const MAX_PLAUSIBLE_OFFSET_MS = 365 * 24 * 60 * 60 * 1000;
/** Au-delà, l'horloge de l'appareil a changé : la nouvelle mesure remplace l'ancienne. */
const JUMP_MS = 60_000;
/** Poids d'une nouvelle mesure proche de l'écart connu. */
const SMOOTHING = 0.25;
/** Un écart plus grand est signalé dans le journal (une fois par saut). */
const NOTICEABLE_OFFSET_MS = 60_000;

let offsetMs: number | null = null;

/** Heure du serveur en millisecondes (Date.now() tant qu'aucun écart n'est connu). */
export function serverNow(): number {
  const now = Date.now();
  return offsetMs === null ? now : Math.round(now + offsetMs);
}

/** Écart connu entre le serveur et l'appareil (ms, positif si l'appareil retarde), null sinon. */
export function serverClockOffset(): number | null {
  return offsetMs;
}

/**
 * Note une heure du serveur : `serverMs`, lue sur une réponse arrivée à `receivedAt` (horloge de
 * l'appareil). Rend vrai si la mesure est retenue.
 */
export function recordServerTime(
  serverMs: number,
  receivedAt: number = Date.now(),
  { canReplace = true }: { canReplace?: boolean } = {},
): boolean {
  if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAt)) return false;
  const sample = serverMs - receivedAt;
  if (Math.abs(sample) > MAX_PLAUSIBLE_OFFSET_MS) return false;
  const jump = offsetMs !== null && Math.abs(sample - offsetMs) > JUMP_MS;
  if (jump && !canReplace) return false;
  if (offsetMs === null || jump) {
    offsetMs = sample;
    if (Math.abs(sample) > NOTICEABLE_OFFSET_MS) {
      log.warn(`Horloge de l'appareil décalée de ${Math.round(sample / 60_000)} min par rapport au serveur : les modifications synchronisées prennent l'heure du serveur`);
    }
  } else {
    offsetMs += (sample - offsetMs) * SMOOTHING;
  }
  return true;
}

/** En-tête `Date` (précis à la seconde : milieu de la seconde), null s'il est absent ou illisible. */
function dateHeaderMs(response: Response): number | null {
  const raw = response.headers.get('date');
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms + 500;
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/** Réponse du serveur d'authentification qui émet un jeton (connexion, renouvellement). */
function isTokenRequest(input: RequestInfo | URL): boolean {
  try {
    return new URL(requestUrl(input)).pathname.endsWith('/auth/v1/token');
  } catch {
    return false;
  }
}

/** Champ `iat` (secondes) du jeton d'accès d'une réponse `/token`, null sinon. Le jeton n'est jamais gardé. */
async function tokenIssuedAtMs(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const token = (body as { access_token?: unknown }).access_token;
    if (typeof token !== 'string') return null;
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    const iat = (claims as { iat?: unknown } | null)?.iat;
    // Précis à la seconde, émis juste avant la réponse : milieu de la seconde
    return typeof iat === 'number' && Number.isFinite(iat) ? iat * 1000 + 500 : null;
  } catch {
    return null;
  }
}

/**
 * `fetch` donné au client Supabase : chaque réponse est rendue telle quelle, l'heure du serveur est
 * lue au passage (en-tête `Date` s'il est lisible, jeton d'une réponse `/token` réussie).
 */
export function createServerClockFetch(baseFetch: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const receivedAt = Date.now();
    try {
      const fromHeader = dateHeaderMs(response);
      if (fromHeader !== null) recordServerTime(fromHeader, receivedAt, { canReplace: false });
      if (response.ok && isTokenRequest(input)) {
        // Copie lue à part : la réponse rendue à Supabase n'est ni retardée ni consommée
        const copy = response.clone();
        void tokenIssuedAtMs(copy)
          .then((ms) => { if (ms !== null) recordServerTime(ms, receivedAt); })
          .catch(() => {});
      }
    } catch {
      // Lecture de l'heure impossible : sans effet sur la réponse
    }
    return response;
  };
}

/** Tests uniquement. */
export function resetServerClock(): void {
  offsetMs = null;
}
