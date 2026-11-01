/**
 * logger.ts — Journal central de l'app
 *
 * Un seul point de passage pour les messages de journal : niveau, préfixe de zone et masquage
 * systématique des identifiants IPTV (`sanitizeIptvUrl`) dans le texte, les erreurs et les objets
 * journalisés. Les messages partent dans la console, où Sentry les relève déjà (fil d'Ariane).
 *
 * Usage :
 *   import { createLogger } from '../utils/logger';
 *   const log = createLogger('Sync');
 *   log.warn('Préférences non synchronisées', err);   // → console.warn('[Sync] Préférences…', err masqué)
 *
 * Niveaux :
 *   debug — seulement en développement (`pnpm dev`), jamais dans la version publiée
 *   info  — étapes utiles au diagnostic
 *   warn  — anomalie rattrapée, l'app continue
 *   error — échec d'une action
 *
 * Migration progressive : les appels `console.*` existants passent au journal quand on touche
 * leur fichier (docs/CONVENTIONS.md). `devLog` reste l'outil des traces détaillées activables à la main.
 */

import { sanitizeIptvUrl } from './sanitizeUrl';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

/** Profondeur maximale de masquage : au-delà, la valeur est remplacée par « […] » (comme sentryScrub). */
const MAX_DEPTH = 4;
const TOO_DEEP = '[…]';

/** Copie masquée des propriétés propres énumérables d'un objet. */
function maskProperties(value: object, depth: number): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) masked[key] = maskLogValue(item, depth + 1);
  return masked;
}

/**
 * Copie masquée d'une valeur journalisée. Texte, erreurs (message, pile, `cause`, propriétés
 * propres), `URL`, `Map`, `Set`, tableaux et objets sont parcourus ; nombres, booléens, dates et
 * éléments du DOM sont rendus tels quels.
 */
export function maskLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeIptvUrl(value);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || (typeof Node !== 'undefined' && value instanceof Node)) return value;
  if (depth >= MAX_DEPTH) return TOO_DEEP;
  if (value instanceof Error) {
    const masked = new Error(sanitizeIptvUrl(value.message));
    masked.name = value.name;
    masked.stack = value.stack === undefined ? undefined : sanitizeIptvUrl(value.stack);
    // `cause` (ES2022) : hors du `lib` TypeScript du projet, d'où le type élargi
    const { cause } = value as Error & { cause?: unknown };
    if (cause !== undefined) (masked as Error & { cause?: unknown }).cause = maskLogValue(cause, depth + 1);
    Object.assign(masked, maskProperties(value, depth));
    return masked;
  }
  if (value instanceof URL) return sanitizeIptvUrl(value.href);
  if (value instanceof Map) {
    return Array.from(value.entries(), ([key, item]) => [maskLogValue(key, depth + 1), maskLogValue(item, depth + 1)]);
  }
  if (value instanceof Set) return Array.from(value, (item) => maskLogValue(item, depth + 1));
  if (Array.isArray(value)) return value.map((item) => maskLogValue(item, depth + 1));
  return maskProperties(value, depth);
}

function write(level: LogLevel, scope: string, message: string, details: unknown[]): void {
  if (level === 'debug' && !import.meta.env.DEV) return;
  const text = `[${scope}] ${sanitizeIptvUrl(message)}`;
  const masked = details.map((detail) => maskLogValue(detail));
  switch (level) {
    case 'debug':
      console.debug(text, ...masked);
      break;
    case 'info':
      console.info(text, ...masked);
      break;
    case 'warn':
      console.warn(text, ...masked);
      break;
    case 'error':
      console.error(text, ...masked);
      break;
  }
}

/** Journal d'une zone de l'app (`Sync`, `Player`, `EPG`…) : chaque message est préfixé par `[zone]`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...details) => write('debug', scope, message, details),
    info: (message, ...details) => write('info', scope, message, details),
    warn: (message, ...details) => write('warn', scope, message, details),
    error: (message, ...details) => write('error', scope, message, details),
  };
}
