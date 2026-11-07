/**
 * Coffre Windows : la page n'atteint que les identifiants de Nyx.
 *
 * Avant, la permission `keyring:default` laissait la page appeler le plugin keyring avec un couple
 * (service, compte) de son choix, donc lire ou effacer l'identifiant d'un autre logiciel dans le
 * Gestionnaire d'identifiants Windows. Désormais : aucune permission keyring, et l'ordinateur passe
 * par nyx_secret_* (service fixé côté Rust, comptes de Nyx seulement, src-tauri/src/secret_vault.rs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
let platform: 'android' | 'ios' | 'windows' = 'windows';
vi.mock('../../utils/platform', () => ({
  isAndroid: () => platform === 'android',
  usesNyxPlugin: () => platform !== 'windows',
}));
vi.mock('../dbCore', () => ({ clearAllData: vi.fn(), hasContent: vi.fn() }));

import { StorageService, setKeyringUser, resetKeyringUser } from '../storage';

const UID = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const creds = { host: 'http://h', username: 'u', password: 'p' };

describe('coffre des identifiants sur ordinateur', () => {
  it('aucune capacité ne donne à la page un accès direct au plugin keyring', () => {
    const dir = resolve(__dirname, '../../../src-tauri/capabilities');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const permissions = (JSON.parse(readFileSync(join(dir, file), 'utf8')) as { permissions: unknown[] }).permissions;
      const names = permissions.map((p) => (typeof p === 'string' ? p : (p as { identifier: string }).identifier));
      expect(names.filter((n) => n.startsWith('keyring:')), file).toEqual([]);
    }
  });

  beforeEach(async () => {
    platform = 'windows';
    invoke.mockReset();
    await StorageService.clearCredentials();
    invoke.mockReset();
    setKeyringUser(UID);
  });

  it('enregistre, relit et efface par nyx_secret_*, avec le seul compte (jamais le service)', async () => {
    invoke.mockResolvedValue(undefined);
    await StorageService.saveCredentials(creds);
    expect(invoke).toHaveBeenLastCalledWith('nyx_secret_set', { user: `iptv_credentials_${UID}`, value: JSON.stringify(creds) });

    await StorageService.clearCredentials();
    expect(invoke).toHaveBeenLastCalledWith('nyx_secret_delete', { user: `iptv_credentials_${UID}` });

    invoke.mockResolvedValueOnce(JSON.stringify(creds));
    expect(await StorageService.getCredentialsAtStartup()).toEqual(creds);
    expect(invoke).toHaveBeenLastCalledWith('nyx_secret_get', { user: `iptv_credentials_${UID}` });
    for (const [command] of invoke.mock.calls) expect(command).toMatch(/^nyx_secret_(get|set|delete)$/);
  });

  it('entrée absente (null) ou compte refusé par Rust : aucun identifiant, sans planter', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await StorageService.getCredentials()).toBeNull();
    resetKeyringUser();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    invoke.mockRejectedValueOnce('Compte du coffre refusé');
    expect(await StorageService.getCredentials()).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith('nyx_secret_get', { user: 'iptv_credentials' });
    error.mockRestore();
  });
});

describe('coffre des identifiants sur iOS', () => {
  beforeEach(async () => {
    platform = 'ios';
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    await StorageService.clearCredentials();
    invoke.mockReset();
    setKeyringUser(UID);
  });

  it('iOS : identifiants dans le coffre du plugin, jamais par nyx_secret_*', async () => {
    const key = `nyxplayer::iptv_credentials_${UID}`;
    invoke.mockResolvedValue(undefined);
    await StorageService.saveCredentials(creds);
    expect(invoke).toHaveBeenLastCalledWith('plugin:nyx-android|secure_set', { key, value: JSON.stringify(creds) });

    await StorageService.clearCredentials();
    expect(invoke).toHaveBeenLastCalledWith('plugin:nyx-android|secure_delete', { key });

    invoke.mockResolvedValueOnce({ value: JSON.stringify(creds) });
    expect(await StorageService.getCredentialsAtStartup()).toEqual(creds);
    expect(invoke).toHaveBeenLastCalledWith('plugin:nyx-android|secure_get', { key });
    for (const [command] of invoke.mock.calls) expect(command).not.toMatch(/^nyx_secret_/);
  });
});
