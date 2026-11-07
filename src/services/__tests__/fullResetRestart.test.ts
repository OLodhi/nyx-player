/**
 * Tests : relance après la remise à zéro. Sur Android, la relance de Tauri ferme le processus
 * en plein vol (plantage natif, localStorage perdu) : après une suppression de compte, l'app
 * replantait à chaque lancement. La page y est rechargée ; l'ordinateur garde la vraie relance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
const relaunchMock = vi.fn();
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: () => relaunchMock() }));
vi.mock('../storage', () => ({ StorageService: { clearCredentials: vi.fn() } }));
vi.mock('../dbCore', () => ({
  closeDatabaseConnection: vi.fn(),
  getDatabaseFileName: () => 'nyxplayer_x.db',
  resetDatabaseName: vi.fn(),
}));
vi.mock('../backgroundWork', () => ({ stopBackgroundWork: vi.fn() }));
vi.mock('../epgService', () => ({ stopSyncForSessionChange: vi.fn(), waitForSyncEnd: vi.fn() }));
vi.mock('../sync/syncScheduler', () => ({ startCloudResync: vi.fn(), stopCloudResync: vi.fn(), waitForCloudResync: vi.fn() }));
vi.mock('../sync/syncState', () => ({ getCurrentSyncUserId: () => 'user-1' }));
vi.mock('../syncService', () => ({ purgeCloudData: vi.fn() }));
vi.mock('../authStorage', () => ({ purgeDurableAuthSession: vi.fn() }));
vi.mock('../supabaseClient', () => ({ SUPABASE_STORAGE_KEY: 'sb-test-auth-token' }));
let platform: 'android' | 'ios' | 'windows' = 'windows';
vi.mock('../../utils/platform', () => ({
  isAndroid: () => platform === 'android',
  usesNyxPlugin: () => platform !== 'windows',
}));

import { performFullReset } from '../fullResetService';
import { ACCOUNT_DELETION_PENDING_KEY, confirmAccountDeletion, markAccountDeletionPending } from '../accountDeletion';

const UID = '11111111-2222-3333-4444-555555555555';
const reloadMock = vi.fn();

describe('performFullReset : relance de l’app', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('location', { ...window.location, reload: reloadMock });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Android : la page est rechargée, sans relance du processus (plantage natif)', async () => {
    platform = 'android';
    markAccountDeletionPending(UID);
    confirmAccountDeletion();

    await performFullReset({ deleteAccount: true });

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalledTimes(1);
    // Nettoyage fini avant le rechargement : le lancement suivant ne le refait pas
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();
  });

  it('iOS : la page est rechargée, sans relance du processus', async () => {
    platform = 'ios';

    await performFullReset();

    expect(relaunchMock).not.toHaveBeenCalled();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('ordinateur : vraie relance, comme avant', async () => {
    platform = 'windows';

    await performFullReset();

    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('affiches réduites du disque effacées aussi, comme la confirmation le promet', async () => {
    platform = 'windows';

    await performFullReset();

    expect(invokeMock).toHaveBeenCalledWith('full_reset', { dbName: 'nyxplayer_x.db' });
    expect(invokeMock).toHaveBeenCalledWith('poster_cache_clear');
  });

  it('effacement des affiches en échec : la réinitialisation va quand même jusqu\'à la relance', async () => {
    platform = 'windows';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    invokeMock.mockImplementation(async (cmd: string) => { if (cmd === 'poster_cache_clear') throw new Error('ipc'); });

    await performFullReset();

    expect(relaunchMock).toHaveBeenCalledTimes(1);
    invokeMock.mockReset();
  });
});
