/**
 * Stockage de la session Supabase : coffre Android (écriture confirmée sur disque), localStorage ailleurs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
let android = true;

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => android }));
const captureMessage = vi.fn();
vi.mock('@sentry/react', () => ({ captureMessage: (...a: unknown[]) => captureMessage(...a) }));

import { authStorageForPlatform, createDurableAuthStorage, purgeDurableAuthSession, resetAuthStorageReports, supabaseStorageKey } from '../authStorage';

const KEY = 'sb-projet-auth-token';

describe('authStorage', () => {
  beforeEach(() => {
    vi.useRealTimers();
    invoke.mockReset();
    captureMessage.mockReset();
    resetAuthStorageReports();
    localStorage.clear();
    android = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('clé de session identique au défaut de Supabase (rien à migrer sous Windows)', () => {
    expect(supabaseStorageKey('https://abcdefgh.supabase.co')).toBe('sb-abcdefgh-auth-token');
  });

  it('Windows / navigateur : stockage par défaut de Supabase (localStorage)', () => {
    android = false;
    expect(authStorageForPlatform()).toBeUndefined();
  });

  it('Android : stockage durable', () => {
    expect(authStorageForPlatform()).toBeDefined();
  });

  it('écriture : ne rend la main qu\'une fois le coffre écrit, et efface une vieille copie du localStorage', async () => {
    let done: () => void = () => {};
    invoke.mockImplementationOnce(() => new Promise<void>((r) => { done = r; }));
    localStorage.setItem(KEY, 'ancienne');
    let resolved = false;
    const p = createDurableAuthStorage().setItem(KEY, 'nouvelle');
    void Promise.resolve(p).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    done();
    await p;
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|secure_set', { key: `supabase-auth::${KEY}`, value: 'nouvelle' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('lecture : le coffre fait foi', async () => {
    invoke.mockResolvedValueOnce({ value: 'session' });
    localStorage.setItem(KEY, 'ancienne');
    expect(await createDurableAuthStorage().getItem(KEY)).toBe('session');
  });

  it('lecture, coffre vide : session du localStorage reprise dans le coffre puis effacée', async () => {
    invoke.mockResolvedValueOnce({ value: null }).mockResolvedValueOnce(undefined);
    localStorage.setItem(KEY, 'ancienne');
    expect(await createDurableAuthStorage().getItem(KEY)).toBe('ancienne');
    expect(invoke).toHaveBeenLastCalledWith('plugin:nyx-android|secure_set', { key: `supabase-auth::${KEY}`, value: 'ancienne' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('reprise impossible (coffre en échec à l\'écriture) : la copie du localStorage est gardée', async () => {
    invoke.mockResolvedValueOnce({ value: null }).mockRejectedValueOnce(new Error('Keystore'));
    localStorage.setItem(KEY, 'ancienne');
    expect(await createDurableAuthStorage().getItem(KEY)).toBe('ancienne');
    expect(localStorage.getItem(KEY)).toBe('ancienne');
  });

  it('lecture, rien nulle part : null', async () => {
    invoke.mockResolvedValueOnce({ value: null });
    expect(await createDurableAuthStorage().getItem(KEY)).toBeNull();
  });

  it('coffre momentanément indisponible : nouvel essai, session retrouvée', async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValueOnce(new Error('Keystore indisponible')).mockResolvedValueOnce({ value: 'session' });
    const p = createDurableAuthStorage().getItem(KEY);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe('session');
  });

  it('coffre indisponible 3 fois : « pas de session » (sans rien effacer), jamais d\'erreur qui bloquerait l\'app', async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValue(new Error('Keystore indisponible'));
    localStorage.setItem(KEY, 'ancienne');
    const p = createDurableAuthStorage().getItem(KEY);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('ancienne');
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  /** Coffre en mémoire dont les `failures` premières écritures sont refusées. */
  function vault(failures: number) {
    const disk = new Map<string, string>();
    let refused = 0;
    invoke.mockImplementation(async (cmd: string, args: { key: string; value?: string }) => {
      if (cmd.endsWith('secure_get')) return { value: disk.get(args.key) ?? null };
      if (cmd.endsWith('secure_set')) {
        if (refused < failures) { refused++; throw new Error('Keystore indisponible'); }
        disk.set(args.key, args.value as string);
        return undefined;
      }
      if (cmd.endsWith('secure_delete')) { disk.delete(args.key); return undefined; }
      throw new Error(cmd);
    });
    return disk;
  }
  const VAULT_KEY = `supabase-auth::${KEY}`;

  it('Écriture refusée une fois par le coffre, nouvel essai et session enregistrée', async () => {
    vi.useFakeTimers();
    const disk = vault(1);
    const p = createDurableAuthStorage().setItem(KEY, 'nouvelle');
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(disk.get(VAULT_KEY)).toBe('nouvelle');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('Écriture refusée 3 fois, la valeur reste lue en mémoire (jamais l\'ancienne), signalée à Sentry, enregistrée à la lecture suivante', async () => {
    vi.useFakeTimers();
    const disk = vault(3);
    disk.set(VAULT_KEY, 'ancienne');
    const storage = createDurableAuthStorage();
    const p = storage.setItem(KEY, 'nouvelle');
    await vi.advanceTimersByTimeAsync(3000);
    await p; // pas d'erreur : Supabase continue avec la session renouvelée
    expect(disk.get(VAULT_KEY)).toBe('ancienne');
    expect(captureMessage).toHaveBeenCalledWith('Session Supabase non enregistrée sur l\'appareil', expect.objectContaining({ tags: { auth_store_entry: 'session' } }));
    expect(await storage.getItem(KEY)).toBe('nouvelle');
    await vi.waitFor(() => expect(disk.get(VAULT_KEY)).toBe('nouvelle'));
  });

  it('Déconnexion après une écriture restée en mémoire, la session ne réapparaît pas', async () => {
    vi.useFakeTimers();
    const disk = vault(3);
    disk.set(VAULT_KEY, 'ancienne');
    const storage = createDurableAuthStorage();
    const p = storage.setItem(KEY, 'nouvelle');
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    await storage.removeItem(KEY);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(disk.has(VAULT_KEY)).toBe(false);
  });

  it('Écritures du coffre dans l\'ordre, une déconnexion pendant un réessai n\'est pas annulée par lui', async () => {
    vi.useFakeTimers();
    const disk = vault(1);
    const storage = createDurableAuthStorage();
    const write = storage.setItem(KEY, 'nouvelle'); // 1er essai refusé, réessai dans 1 s
    const removed = storage.removeItem(KEY); // déconnexion pendant l'attente
    await vi.advanceTimersByTimeAsync(3000);
    await write;
    await removed;
    expect(disk.has(VAULT_KEY)).toBe(false);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('Pendant un réessai, une lecture rend la valeur la plus récente, jamais celle du coffre', async () => {
    vi.useFakeTimers();
    const disk = vault(1);
    disk.set(VAULT_KEY, 'ancienne');
    const storage = createDurableAuthStorage();
    const write = storage.setItem(KEY, 'nouvelle');
    await vi.advanceTimersByTimeAsync(0); // 1er essai refusé, réessai en attente
    expect(await storage.getItem(KEY)).toBe('nouvelle');
    expect(await storage.peekItem(KEY)).toBe('nouvelle');
    await vi.advanceTimersByTimeAsync(1000);
    await write;
    expect(disk.get(VAULT_KEY)).toBe('nouvelle');
  });

  it('Coffre durablement en panne, signalé une seule fois à Sentry par lancement', async () => {
    vi.useFakeTimers();
    vault(Infinity);
    const storage = createDurableAuthStorage();
    for (const value of ['v1', 'v2']) {
      const p = storage.setItem(KEY, value);
      await vi.advanceTimersByTimeAsync(3000);
      await p;
    }
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(await storage.getItem(KEY)).toBe('v2');
  });

  it('Suppression du compte après une écriture restée en mémoire, la session ne réapparaît pas', async () => {
    vi.useFakeTimers();
    const disk = vault(3);
    disk.set(VAULT_KEY, 'ancienne');
    const storage = createDurableAuthStorage();
    const p = storage.setItem(KEY, 'nouvelle');
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    await purgeDurableAuthSession(KEY);
    expect(await storage.getItem(KEY)).toBeNull();
    expect(disk.has(VAULT_KEY)).toBe(false);
  });

  it('lecture de diagnostic : sans réessai, sans reprise du localStorage, sans écriture', async () => {
    const disk = vault(0);
    localStorage.setItem(KEY, 'ancienne');
    expect(await createDurableAuthStorage().peekItem(KEY)).toBeNull();
    expect(disk.has(VAULT_KEY)).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('ancienne');
    expect(invoke.mock.calls.every((c) => String(c[0]).endsWith('secure_get'))).toBe(true);
  });

  it('suppression : coffre et localStorage', async () => {
    invoke.mockResolvedValueOnce(undefined);
    localStorage.setItem(KEY, 'ancienne');
    await createDurableAuthStorage().removeItem(KEY);
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|secure_delete', { key: `supabase-auth::${KEY}` });
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('suppression du compte (Android) : session, code PKCE et utilisateur effacés du coffre', async () => {
    invoke.mockResolvedValue(undefined);
    await purgeDurableAuthSession(KEY);
    expect(invoke.mock.calls.map((c) => (c[1] as { key: string }).key)).toEqual([
      `supabase-auth::${KEY}`, `supabase-auth::${KEY}-code-verifier`, `supabase-auth::${KEY}-user`,
    ]);
  });

  it('suppression du compte (Windows) : rien à faire dans le coffre', async () => {
    android = false;
    await purgeDurableAuthSession(KEY);
    expect(invoke).not.toHaveBeenCalled();
  });
});
