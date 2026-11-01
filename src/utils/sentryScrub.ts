/**
 * sentryScrub.ts — Nettoyage des événements Sentry avant envoi.
 *
 * Les messages d'erreur (Rust ou fournisseur) peuvent contenir une URL Xtream avec les identifiants.
 * Sentry garde aussi une copie brute des arguments console (`breadcrumb.data.arguments`) : on nettoie
 * donc tout le texte d'un événement, pas seulement `breadcrumb.message`.
 *
 * Moins de données : en plus des identifiants, on
 * retire l'hôte du fournisseur IPTV (et le chemin de ses adresses : numéro du flux), les paramètres
 * de toutes les adresses (Supabase `user_id=eq.<uuid>`, jetons), les jetons, identifiants de compte,
 * adresses e-mail et adresses IP. Le type d'erreur, la pile d'appels, l'écran (composant) et la
 * version restent lisibles.
 */
import type { Breadcrumb, BrowserOptions, ErrorEvent, Event } from '@sentry/react';

type Integration = Exclude<BrowserOptions['integrations'], ((...args: never[]) => unknown) | undefined>[number];
import { sanitizeIptvUrl } from './sanitizeUrl';

const MAX_DEPTH = 6;

/** Hôtes connus, sans rapport avec le fournisseur : hôte et chemin gardés (paramètres retirés). */
const KNOWN_HOSTS = [
  /^(tauri\.|ipc\.|asset\.)?localhost$/, // app Tauri (Windows, Android), serveur de dev
  /^127\.0\.0\.1$/,
  /(^|\.)themoviedb\.org$/,
  /(^|\.)tmdb\.org$/,
  /(^|\.)supabase\.co$/,
  /(^|\.)nyxplayer\.app$/,
  /(^|\.)github\.com$/,
  /(^|\.)githubusercontent\.com$/,
];

const isKnownHost = (host: string) => KNOWN_HOSTS.some((re) => re.test(host.toLowerCase()));

/**
 * Adresses locales dont le chemin est gardé : les pages et appels de l'app elle-même. Un simple
 * `localhost` ou `127.0.0.1` en http(s) peut être un proxy IPTV local (forme courte `/USER/PASS/123`
 * sur le port 80) : l'hôte reste lisible, mais pas son chemin.
 */
function keepsPath(scheme: string, host: string): boolean {
  const h = host.toLowerCase();
  if (h !== 'localhost' && h !== '127.0.0.1') return true;
  return scheme.toLowerCase() === 'tauri' && h === 'localhost';
}

/** Premier segment de chemin Xtream gardé pour le fournisseur : il dit quel type d'appel a échoué. */
const PROVIDER_KINDS = new Set(['live', 'movie', 'series', 'timeshift', 'player_api.php', 'get.php', 'xmltv.php']);

export const MASKED_HOST = '[fournisseur]';

/** Au-delà, un texte est tronqué avant nettoyage (journaux géants : M3U, JSON du fournisseur…). */
const MAX_TEXT = 10_000;

// Adresse avec schéma (http, https, rtmp, tauri…) ; hôte IPv6 entre crochets accepté ; s'arrête aux
// espaces, guillemets et parenthèses. Longueurs bornées : pas d'emballement sur un long texte.
const URL_RE = /\b([a-z][a-z0-9+.-]{0,15}):\/\/((?:[^\s/?#"'<>()[\]@]{0,256}@)?(?:\[[0-9a-f:.%\w]{1,64}\]|[^\s/?#"'<>()[\]]{0,256}))([^\s?#"'<>()[\]]*)(\?[^\s#"'<>()[\]]*)?(#[^\s"'<>()[\]]*)?/gi;

function maskUrl(_match: string, scheme: string, authority: string, path: string, query?: string, hash?: string): string {
  // Identifiants éventuels avant « @ » : jamais gardés
  const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  const host = hostPort.replace(/:\d+$/, '');
  const rest = query || hash ? '?[…]' : '';
  if (isKnownHost(host)) {
    if (keepsPath(scheme, host)) return `${scheme}://${hostPort}${path}${rest}`;
    return `${scheme}://${hostPort}${path.length > 1 ? '/…' : path}${rest}`;
  }
  const first = path.split('/')[1] ?? '';
  const kind = PROVIDER_KINDS.has(first.toLowerCase()) ? `/${first}` : '';
  const tail = path.length > kind.length + 1 ? '/…' : '';
  return `${scheme}://${MASKED_HOST}${kind}${tail}${rest}`;
}

/** Adresse IPv4 (hors 127.x) masquée ; un numéro de version (octet > 255) reste tel quel. */
function maskIp(ip: string): string {
  const octets = ip.split(':')[0].split('.').map(Number);
  if (octets.some((n) => n > 255) || octets[0] === 127) return ip;
  return '[ip]';
}

/** Nom d'hôte sans schéma, avec un port (`iptv.exemple.tv:8080`) ou après « host »/« hostname ». */
function maskBareHost(match: string, prefix: string, host: string): string {
  return isKnownHost(host) ? match : `${prefix}${MASKED_HOST}`;
}

/** Fichiers de code (`index-abc.js:430`) : ce ne sont pas des hôtes. */
const CODE_EXT = /^(js|mjs|cjs|jsx|ts|tsx|rs|css|html|json|map|vue|kt|java)$/i;

function maskHostPort(match: string, host: string, ext: string): string {
  return CODE_EXT.test(ext) || isKnownHost(host) ? match : MASKED_HOST;
}

/** Adresses encodées (`http%3A%2F%2F…`, JSON `http:\/\/…`) : décodées pour être nettoyées. */
function decodeUrls(text: string): string {
  if (!/%3A%2F%2F|:\\\/\\\//i.test(text)) return text;
  return text
    .replace(/\\\//g, '/')
    .replace(/%3A%2F%2F/gi, '://')
    .replace(/%2F/gi, '/')
    .replace(/%3F/gi, '?')
    .replace(/%26/gi, '&')
    .replace(/%3D/gi, '=')
    .replace(/%40/gi, '@');
}

/**
 * Nettoie un texte libre : identifiants Xtream, adresses (hôte du fournisseur, paramètres),
 * jetons et clés, identifiants de compte (UUID), e-mails et adresses IP.
 */
export function scrubText(text: string): string {
  const bounded = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}[…]` : text;
  return sanitizeIptvUrl(decodeUrls(bounded))
    .replace(URL_RE, maskUrl)
    .replace(/\b(host(?:name)?\s*[:=]?\s*)([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,10})\b/gi, maskBareHost)
    .replace(/(?<![\w./:-])([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,10}\.([a-z]{2,24})):\d{1,5}\b/gi, maskHostPort)
    .replace(/\beyJ[\w-]{5,}\.[\w-]{2,}(?:\.[\w-]*)?/g, '[jeton]')
    .replace(/\bsb_(?:secret|publishable)_[\w-]+/g, '[clé]')
    .replace(/\b(Bearer|Basic|Token)\s+[\w.~+/=-]+/gi, '$1 [jeton]')
    .replace(/\b(access_token|refresh_token|provider_token|apikey|api_key|token|password|username)=[^&\s"'#]+/gi, '$1=[…]')
    .replace(/(["']?)\b(password|passwd|secret|api[_-]?key|x-api-key)\1(\s*:\s*)(["']?)[^\s"',}&]+\4/gi, '$1$2$1$3$4[…]$4')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){0,8}\.[a-z]{2,24}\b/gi, '[e-mail]')
    .replace(/(?<![\w./])(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, maskIp);
}

/** Clés dont la valeur n'est jamais envoyée (en-têtes, corps de requête journalisés…). */
const SECRET_KEY_RE = /^(authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|apikey|api_key|x-api-key|username)$/i;

/** Nettoie récursivement toutes les chaînes d'une valeur (objets, tableaux, erreurs). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (value instanceof Error) {
    return `${value.name}: ${scrubText(value.message)}`;
  }
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[Filtered]' : scrubValue(v, depth + 1);
  }
  return out;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  if (breadcrumb.data) breadcrumb.data = scrubValue(breadcrumb.data) as Breadcrumb['data'];
  return breadcrumb;
}

/** Nettoie tout événement : erreur, retour « Signaler un problème » ou transaction. */
export function scrubEvent<T extends Event>(event: T): T {
  delete event.user;
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry?.message) event.logentry.message = scrubText(event.logentry.message);
  if (event.logentry?.params) event.logentry.params = scrubValue(event.logentry.params) as unknown[];
  if (event.transaction) event.transaction = scrubText(event.transaction);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    if (ex.mechanism?.data) ex.mechanism.data = scrubValue(ex.mechanism.data) as typeof ex.mechanism.data;
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = scrubText(frame.filename);
      if (frame.abs_path) frame.abs_path = scrubText(frame.abs_path);
    }
  }
  if (event.fingerprint) event.fingerprint = event.fingerprint.map(scrubText);
  // Retour « Signaler un problème » : contexts.feedback.message, nettoyé avec les autres contextes
  if (event.extra) event.extra = scrubValue(event.extra) as T['extra'];
  if (event.contexts) event.contexts = scrubValue(event.contexts) as T['contexts'];
  if (event.tags) event.tags = scrubValue(event.tags) as T['tags'];
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.spans) event.spans = scrubValue(event.spans) as T['spans'];
  if (event.request) {
    const userAgent = event.request.headers?.['User-Agent'];
    event.request = {
      ...(event.request.url ? { url: scrubText(event.request.url) } : {}),
      ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
    };
  }
  return event;
}

/** `beforeSend` ne voit que les erreurs : typé pour Sentry.init. */
export const scrubErrorEvent: (event: ErrorEvent) => ErrorEvent = scrubEvent;

/**
 * `beforeSend` ne s'applique ni aux retours (`captureFeedback`) ni aux transactions : cette
 * intégration les nettoie avant l'envoi, avec les mêmes règles.
 */
export const scrubOtherEventsIntegration: Integration = {
  name: 'NyxScrubOtherEvents',
  processEvent(event: Event) {
    return event.type ? scrubEvent(event) : event;
  },
};

/** Réglages de vie privée de Sentry.init (main.tsx), réunis ici pour être testés tels quels. */
export function sentryPrivacyOptions(): Pick<BrowserOptions, 'beforeSend' | 'beforeBreadcrumb' | 'integrations'> {
  return {
    beforeSend: scrubErrorEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    integrations: (defaults) => [...defaults, scrubOtherEventsIntegration],
  };
}
