import { createLogger } from './logger';

/**
 * Promesse lancée sans attente (effet React, écouteur) : son échec est journalisé au lieu de passer
 * en silence. Usage : `promesse.then(setX).catch(warnOnReject('Carte'))`.
 */
export function warnOnReject(context: string): (err: unknown) => void {
  return (err) => createLogger(context).warn('Opération asynchrone en échec :', err);
}
