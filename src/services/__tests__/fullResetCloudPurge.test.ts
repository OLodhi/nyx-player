/**
 * Tests : « Supprimer aussi mes données cloud » en échec partiel.
 * La remise à zéro s'arrête avant d'effacer quoi que ce soit sur l'appareil et signale l'échec.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
const relaunchMock = vi.fn();
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunchMock() }));
const clearCredentialsMock = vi.fn();
vi.mock('../storage', () => ({ StorageService: { clearCredentials: () => clearCredentialsMock() } }));
let dbFileName: string | null = 'nyx.db';
const dbCalls: string[] = [];
vi.mock('../dbCore', () => ({
  closeDatabaseConnection: vi.fn(async () => { dbCalls.push(`close:${dbFileName}`); }),
  getDatabaseFileName: () => dbFileName,
  resetDatabaseName: () => { dbFileName = null; },
}));
vi.mock('../backgroundWork', () => ({ stopBackgroundWork: vi.fn() }));
vi.mock('../epgService', () => ({ stopSyncForSessionChange: vi.fn(), waitForSyncEnd: vi.fn() }));
const startCloudResyncMock = vi.fn();
vi.mock('../sync/syncScheduler', () => ({
  startCloudResync: (id: string) => startCloudResyncMock(id),
  stopCloudResync: vi.fn(),
  waitForCloudResync: vi.fn(),
}));
let syncUserId: string | null = 'user-1';
vi.mock('../sync/syncState', () => ({ getCurrentSyncUserId: () => syncUserId }));
const purgeCloudDataMock = vi.fn<() => Promise<string[]>>();
vi.mock('../syncService', () => ({ purgeCloudData: () => purgeCloudDataMock() }));
vi.mock('../authStorage', () => ({ purgeDurableAuthSession: vi.fn() }));
vi.mock('../supabaseClient', () => ({ SUPABASE_STORAGE_KEY: 'sb-test-auth-token' }));

import { performFullReset, CloudPurgeError } from '../fullResetService';
import { ACCOUNT_DELETED_NOTICE_KEY, ACCOUNT_DELETION_PENDING_KEY, confirmAccountDeletion, markAccountDeletionPending } from '../accountDeletion';

describe('performFullReset : purge du cloud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncUserId = 'user-1';
    dbFileName = 'nyx.db';
    dbCalls.length = 0;
    localStorage.clear();
    localStorage.setItem('nyx_setting', 'garde');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it("échec partiel : erreur signalée, rien d'effacé sur l'appareil, synchro relancée", async () => {
    purgeCloudDataMock.mockResolvedValue(['user_watchlist']);

    const run = performFullReset({ purgeCloud: true });
    await expect(run).rejects.toBeInstanceOf(CloudPurgeError);
    await expect(run).rejects.toMatchObject({ failedTables: ['user_watchlist'] });

    expect(clearCredentialsMock).not.toHaveBeenCalled();
    expect(localStorage.getItem('nyx_setting')).toBe('garde');
    expect(invokeMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(startCloudResyncMock).toHaveBeenCalledWith('user-1');
  });

  it('purge réussie : la remise à zéro va jusqu\'au bout', async () => {
    purgeCloudDataMock.mockResolvedValue([]);

    await performFullReset({ purgeCloud: true });

    expect(clearCredentialsMock).toHaveBeenCalled();
    expect(localStorage.getItem('nyx_setting')).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('full_reset', { dbName: 'nyx.db' });
    expect(relaunchMock).toHaveBeenCalled();
    expect(startCloudResyncMock).not.toHaveBeenCalled();
    // Nom oublié avant la fermeture : un accès tardif ne peut plus rouvrir le fichier à supprimer
    expect(dbCalls).toEqual(['close:null']);
  });

  it('sans purge du cloud : aucune purge demandée', async () => {
    await performFullReset();
    expect(purgeCloudDataMock).not.toHaveBeenCalled();
    expect(relaunchMock).toHaveBeenCalled();
  });

  it("sans session de synchro : rien n'est tenté ni effacé, raison distincte", async () => {
    syncUserId = null;
    const run = performFullReset({ purgeCloud: true });
    await expect(run).rejects.toMatchObject({ reason: 'no-session' });
    expect(purgeCloudDataMock).not.toHaveBeenCalled();
    expect(clearCredentialsMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});

describe('performFullReset : suppression du compte', () => {
  const uid = '0b8f2a6e-7c1d-4e5f-9a3b-2c4d6e8f0a1b';

  beforeEach(() => {
    vi.clearAllMocks();
    syncUserId = 'user-1';
    dbFileName = 'nyx.db';
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it("la marque de suppression reste pendant le nettoyage et part une fois la base effacée", async () => {
    markAccountDeletionPending(uid);
    confirmAccountDeletion();
    let markDuringDelete: string | null = null;
    invokeMock.mockImplementationOnce(async () => { markDuringDelete = localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY); });

    await performFullReset({ deleteAccount: true });

    // App fermée pendant l'effacement de la base : le lancement suivant reprendrait le nettoyage
    expect(markDuringDelete).toContain(uid);
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();
    expect(relaunchMock).toHaveBeenCalled();
  });

  it('effacement de la base en échec : la marque reste pour un nouvel essai au lancement', async () => {
    markAccountDeletionPending(uid);
    confirmAccountDeletion();
    invokeMock.mockRejectedValueOnce(new Error('fichier verrouillé'));

    await performFullReset({ deleteAccount: true });

    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toContain(uid);
  });

  it('compte supprimé depuis un autre appareil : le message pour l\'écran de connexion est gardé', async () => {
    markAccountDeletionPending(uid);
    confirmAccountDeletion();
    localStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, '1');

    await performFullReset({ deleteAccount: true });

    expect(localStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY)).toBe('1');
  });

  it("remise à zéro ordinaire : pas de marque gardée", async () => {
    localStorage.setItem(ACCOUNT_DELETION_PENDING_KEY, 'reste');
    await performFullReset();
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();
  });
});
