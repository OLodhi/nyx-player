/**
 * Tests : compte supprimé depuis un autre appareil, encore utilisable sur un appareil connecté.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getUser = vi.fn();
const getSession = vi.fn();
vi.mock('../supabaseClient', () => ({
  supabase: { auth: { getUser: (jwt?: string) => getUser(jwt), getSession: () => getSession() } },
}));

import {
  checkAccountStillExists,
  consumeAccountDeletedNotice,
  isDeletedAccountError,
  resetAccountExistenceCheck,
  scheduleAccountExistenceCheck,
} from '../accountExistenceCheck';
import {
  ACCOUNT_DELETED_NOTICE_KEY,
  ACCOUNT_DELETION_PENDING_KEY,
  finishPendingAccountDeletion,
  markAccountDeletionPending,
} from '../accountDeletion';

const UID = '0b8f2a6e-7c1d-4e5f-9a3b-2c4d6e8f0a1b';
const OTHER = '1c9e3b7f-8d2e-4f60-ab4c-3d5e7f9a1b2c';

/** Réponse de Supabase quand l'utilisateur du jeton a été supprimé (403, code « user_not_found ») */
const userNotFound = { name: 'AuthApiError', status: 403, code: 'user_not_found', message: 'User from sub claim in JWT does not exist' };

function sessionOf(uid: string | null) {
  return { data: { session: uid ? { user: { id: uid }, access_token: `jeton-${uid}` } : null } };
}

describe('accountExistenceCheck', () => {
  let cleanup: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    resetAccountExistenceCheck();
    cleanup = vi.fn(async () => true);
    getSession.mockResolvedValue(sessionOf(UID));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('compte supprimé sur un autre appareil : cet appareil est nettoyé comme celui qui a supprimé le compte', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: userNotFound });

    await expect(checkAccountStillExists(UID, cleanup)).resolves.toBe(false);

    expect(cleanup).toHaveBeenCalledTimes(1);
    // Marque confirmée avec le compte : sa base et ses identifiants IPTV sont visés, et une app
    // fermée pendant le nettoyage le finit au lancement suivant
    expect(JSON.parse(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY) ?? '{}')).toMatchObject({ uid: UID, confirmed: true });
    expect(localStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY)).toBe('1');
  });

  it('chaîne complète : la reprise de suppression vise la base et les identifiants de ce compte', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: userNotFound });
    const reset = vi.fn(async (_uid: string | null) => {});

    await checkAccountStillExists(UID, () => finishPendingAccountDeletion(reset));

    expect(reset).toHaveBeenCalledWith(UID);
  });

  it('compte existant : rien ne change', async () => {
    getUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });

    await expect(checkAccountStillExists(UID, cleanup)).resolves.toBe(true);

    expect(cleanup).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();
    expect(localStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY)).toBeNull();
  });

  it('hors ligne ou serveur en panne : rien ne change, et la vérification sera refaite', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } });
    getUser.mockRejectedValueOnce(new Error('réseau coupé'));
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { name: 'AuthApiError', status: 500, code: 'unexpected_failure' } });

    await checkAccountStillExists(UID, cleanup);
    await checkAccountStillExists(UID, cleanup);
    await checkAccountStillExists(UID, cleanup);

    expect(getUser).toHaveBeenCalledTimes(3);
    expect(cleanup).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();
  });

  it('session introuvable : Supabase s\'en charge lui-même (déconnexion), pas de nettoyage complet', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError', status: 400, code: 'session_not_found' } });

    await checkAccountStillExists(UID, cleanup);

    expect(cleanup).not.toHaveBeenCalled();
  });

  it('un autre compte connecté entre-temps : il n\'est pas touché, et le serveur est interrogé avec le jeton du compte visé', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: userNotFound });
    getSession.mockResolvedValue(sessionOf(OTHER));

    await checkAccountStillExists(UID, cleanup);
    expect(getUser).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY)).toBeNull();

    getSession.mockResolvedValue(sessionOf(UID));
    resetAccountExistenceCheck();
    await checkAccountStillExists(UID, cleanup);
    expect(getUser).toHaveBeenCalledWith(`jeton-${UID}`);
  });

  it('suppression déjà en cours sur cet appareil (Réglages) : pas de second nettoyage ni de message « autre appareil »', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: userNotFound });
    markAccountDeletionPending(UID);

    await checkAccountStillExists(UID, cleanup);

    expect(getUser).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
    expect(localStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY)).toBeNull();
  });

  it('changement de compte pendant une vérification : le nouveau compte est vérifié juste après', async () => {
    let release: () => void = () => {};
    getUser.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ data: { user: { id: UID } }, error: null });
    }));
    getUser.mockResolvedValue({ data: { user: { id: OTHER } }, error: null });

    const first = checkAccountStillExists(UID, cleanup);
    await vi.waitFor(() => expect(getUser).toHaveBeenCalledTimes(1));
    getSession.mockResolvedValue(sessionOf(OTHER));
    await checkAccountStillExists(OTHER, cleanup);
    release();
    await first;

    await vi.waitFor(() => expect(getUser).toHaveBeenCalledTimes(2));
    expect(getUser).toHaveBeenLastCalledWith(`jeton-${OTHER}`);
  });

  it('SIGNED_IN répétés au retour au premier plan : une seule demande au serveur par minute et par compte', async () => {
    vi.useFakeTimers();
    getUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });

    await checkAccountStillExists(UID, cleanup);
    await checkAccountStillExists(UID, cleanup);
    expect(getUser).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);
    await checkAccountStillExists(UID, cleanup);
    expect(getUser).toHaveBeenCalledTimes(2);

    // Un autre compte est vérifié tout de suite
    getSession.mockResolvedValue(sessionOf(OTHER));
    await checkAccountStillExists(OTHER, cleanup);
    expect(getUser).toHaveBeenCalledTimes(3);
  });

  it('depuis l\'écouteur Supabase : la vérification part après lui (verrou de session)', async () => {
    vi.useFakeTimers();
    getUser.mockResolvedValue({ data: { user: { id: UID } }, error: null });

    scheduleAccountExistenceCheck(UID);
    expect(getUser).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('seul « user_not_found » désigne un compte supprimé', () => {
    expect(isDeletedAccountError(userNotFound)).toBe(true);
    expect(isDeletedAccountError({ code: 'session_not_found' })).toBe(false);
    expect(isDeletedAccountError({ status: 403 })).toBe(false);
    expect(isDeletedAccountError(null)).toBe(false);
    expect(isDeletedAccountError('user_not_found')).toBe(false);
  });

  it('message de l\'écran de connexion : lu une seule fois', () => {
    expect(consumeAccountDeletedNotice()).toBe(false);
    localStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, '1');
    expect(consumeAccountDeletedNotice()).toBe(true);
    expect(consumeAccountDeletedNotice()).toBe(false);
  });
});
