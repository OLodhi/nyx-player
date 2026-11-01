/**
 * Journal central : niveaux, préfixe de zone, masquage des identifiants IPTV.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createLogger, maskLogValue } from '../logger';

const STREAM = 'http://fournisseur.example:8080/live/jean/secret/42.ts';
const MASKED = 'http://fournisseur.example:8080/live/***/***/42.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('journal central', () => {
  it('préfixe la zone et envoie chaque niveau à la console correspondante', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('Sync');

    log.info('début');
    log.warn('lent', 3);
    log.error('échec');

    expect(info).toHaveBeenCalledWith('[Sync] début');
    expect(warn).toHaveBeenCalledWith('[Sync] lent', 3);
    expect(error).toHaveBeenCalledWith('[Sync] échec');
  });

  it('masque les identifiants dans le message, les erreurs et les objets', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = createLogger('Player');

    log.warn(`lecture de ${STREAM}`, new Error(`HTTP 403 ${STREAM}`), { url: STREAM, essais: [STREAM] });

    const [text, err, details] = warn.mock.calls[0];
    expect(text).toBe(`[Player] lecture de ${MASKED}`);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`HTTP 403 ${MASKED}`);
    expect((err as Error).stack).not.toContain('secret');
    expect(details).toEqual({ url: MASKED, essais: [MASKED] });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('laisse intactes les valeurs sans identifiant (nombres, dates, erreurs propres)', () => {
    const date = new Date(0);
    expect(maskLogValue(42)).toBe(42);
    expect(maskLogValue(date)).toBe(date);
    expect(maskLogValue(null)).toBeNull();
    const err = maskLogValue(new TypeError('réseau coupé')) as Error;
    expect(err.name).toBe('TypeError');
    expect(err.message).toBe('réseau coupé');
  });

  it("masque la cause et les propriétés d'une erreur, les URL, Map et Set", () => {
    const err = Object.assign(new Error('échec'), { cause: new Error(STREAM), url: STREAM });
    const masked = maskLogValue(err) as Error & { url: string; cause: unknown };
    expect((masked.cause as Error).message).toBe(MASKED);
    expect(masked.url).toBe(MASKED);
    expect(maskLogValue(new URL(STREAM))).toBe(MASKED);
    expect(maskLogValue(new Map([['flux', STREAM]]))).toEqual([['flux', MASKED]]);
    expect(maskLogValue(new Set([STREAM]))).toEqual([MASKED]);
  });

  it('remplace ce qui dépasse la profondeur de masquage au lieu de le rendre brut', () => {
    const deep = { a: { b: { c: { d: { e: STREAM } } } } };
    expect(JSON.stringify(maskLogValue(deep))).not.toContain('secret');
    expect(maskLogValue(deep)).toEqual({ a: { b: { c: { d: '[…]' } } } });
  });

  it("debug n'écrit rien hors développement", () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubEnv('DEV', false);
    createLogger('EPG').debug('détail');
    expect(debug).not.toHaveBeenCalled();

    vi.stubEnv('DEV', true);
    createLogger('EPG').debug('détail');
    expect(debug).toHaveBeenCalledWith('[EPG] détail');
  });
});
