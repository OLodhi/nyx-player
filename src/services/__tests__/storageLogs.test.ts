/**
 * Journaux du coffre : une lecture illisible ne recopie jamais les identifiants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => true }));
vi.mock('../dbCore', () => ({ clearAllData: vi.fn(), hasContent: vi.fn() }));

import { StorageService, describeVaultError } from '../storage';

/** Texte illisible : V8 en recopie le début dans son message (« Unexpected token 'j', "jean:S3cret" is not valid JSON ») */
const BROKEN = 'jean:S3cret';

/** Ce que la console afficherait (une erreur s'affiche avec son message) */
const logged = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.flat().map(String).join('\n');

describe('journaux du coffre', () => {
  let error: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.useFakeTimers();
    await StorageService.clearCredentials();
    invoke.mockReset();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    error.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  it('JSON illisible : message générique, sans le texte lu', () => {
    let parseError: unknown;
    try { JSON.parse(BROKEN); } catch (e) { parseError = e; }
    expect(describeVaultError(parseError)).toBe('identifiants enregistrés illisibles (JSON invalide)');
  });

  it('autre erreur : citée, adresses masquées, longueur bornée', () => {
    const text = describeVaultError(new Error('échec http://h.invalid/live/jean/S3cret/1.ts ' + 'x'.repeat(500)));
    expect(text).not.toContain('S3cret');
    expect(text.length).toBeLessThanOrEqual(200);
    expect(describeVaultError('Keystore indisponible')).toBe('Keystore indisponible');
  });

  it('getCredentials sur des identifiants abîmés : rien du contenu dans le journal', async () => {
    invoke.mockResolvedValue({ value: BROKEN });
    expect(await StorageService.getCredentials()).toBeNull();
    expect(logged(error)).not.toMatch(/S3cret|jean/);
  });

  it('démarrage Android sur des identifiants abîmés : rien du contenu dans le journal', async () => {
    invoke.mockResolvedValue({ value: BROKEN });
    const p = StorageService.getCredentialsAtStartup();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBeNull();
    expect(logged(warn)).not.toMatch(/S3cret|jean/);
    expect(logged(warn)).toContain('JSON invalide');
  });
});
