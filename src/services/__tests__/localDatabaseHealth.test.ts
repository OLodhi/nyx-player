/**
 * Base locale abîmée : reconnue par le contrôle du Rust, pour que l'écran du fournisseur
 * propose la réinitialisation au lieu de laisser l'utilisateur bloqué.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
let fileName: string | null = 'nyxplayer_a.db';
vi.mock('../dbCore', () => ({ getDatabaseFileName: () => fileName }));

import { checkLocalDatabase, isDatabaseDamagedError, isLocalDatabaseDamaged } from '../localDatabaseHealth';

beforeEach(async () => {
  invoke.mockReset();
  fileName = 'nyxplayer_a.db';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // État remis à zéro : base saine
  invoke.mockResolvedValueOnce('ok');
  await checkLocalDatabase();
  invoke.mockReset();
});

describe('isDatabaseDamagedError', () => {
  it.each([
    'error returned from database: (code: 26) file is not a database',
    'error returned from database: (code: 11) database disk image is malformed',
    new Error('database disk image is malformed'),
  ])('base abîmée : %s', (error) => {
    expect(isDatabaseDamagedError(error)).toBe(true);
  });

  it.each(['database is locked', new Error('Failed to fetch'), 'CREDENTIALS_REJECTED'])('autre erreur : %s', (error) => {
    expect(isDatabaseDamagedError(error)).toBe(false);
  });
});

describe('checkLocalDatabase', () => {
  it('base abîmée : contrôle demandé au Rust pour la base du compte, réinitialisation proposée', async () => {
    invoke.mockResolvedValueOnce('corrupt');
    expect(await checkLocalDatabase()).toBe('corrupt');
    expect(invoke).toHaveBeenCalledWith('nyx_db_check', { db: 'sqlite:nyxplayer_a.db' });
    expect(isLocalDatabaseDamaged()).toBe(true);
  });

  it('base d\'un autre compte abîmée : rien proposé pour celle-ci', async () => {
    invoke.mockResolvedValueOnce('corrupt');
    await checkLocalDatabase();
    fileName = 'nyxplayer_b.db';
    expect(isLocalDatabaseDamaged()).toBe(false);
  });

  it('base tenue par un autre programme ou contrôle impossible : rien proposé', async () => {
    invoke.mockResolvedValueOnce('unreadable');
    await checkLocalDatabase();
    invoke.mockRejectedValueOnce(new Error('ipc'));
    expect(await checkLocalDatabase()).toBe('unreadable');
    expect(isLocalDatabaseDamaged()).toBe(false);
  });
});
