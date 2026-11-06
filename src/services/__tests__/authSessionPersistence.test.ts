/**
 * Reproduction de la perte de session Android avec le vrai client Supabase.
 *
 * Faux serveur Supabase : chaque renouvellement remplace le jeton de renouvellement et invalide
 * l'ancien (« Refresh Token Not Found » s'il revient). Faux « disque » : ce qui survit à l'arrêt
 * brutal de l'app. Le localStorage du WebView Android n'y écrit qu'en différé ; le coffre Android,
 * lui, n'a rendu la main qu'une fois la valeur sur disque.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

// Coffre Android simulé : `secure_set` n'aboutit qu'une fois la valeur sur le « disque »
const disk = new Map<string, string>();
const vaultImpl = async (cmd: string, args: { key: string; value?: string }) => {
  if (cmd === 'plugin:nyx-android|secure_get') return { value: disk.get(args.key) ?? null };
  if (cmd === 'plugin:nyx-android|secure_set') { disk.set(args.key, args.value as string); return; }
  if (cmd === 'plugin:nyx-android|secure_delete') { disk.delete(args.key); return; }
  throw new Error(`commande inattendue ${cmd}`);
};
const invoke = vi.fn(vaultImpl);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args: { key: string; value?: string }) => invoke(cmd, args) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => true, usesNyxPlugin: () => true }));
const captureMessage = vi.fn();
vi.mock('@sentry/react', () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

import { createDurableAuthStorage, resetAuthStorageReports } from '../authStorage';
import { trackAuthEvent, wasSessionLost, resetAuthSessionWatch } from '../authSessionWatch';

const URL_ = 'https://projet.supabase.co';
const KEY = 'sb-projet-auth-token';
const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', email: 'w@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

/** Faux serveur : un seul jeton de renouvellement valide à la fois (rotation). */
function fakeServer() {
  let n = 0;
  let valid = 'rt-0';
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/token?grant_type=refresh_token')) {
      const { refresh_token } = JSON.parse(String(init?.body));
      if (refresh_token !== valid) {
        return new Response(JSON.stringify({ code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      valid = `rt-${++n}`;
      return new Response(JSON.stringify({ access_token: `at-${n}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: valid, user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/logout')) return new Response(null, { status: 204 });
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  return { fetch, validToken: () => valid };
}

/** Session enregistrée il y a plusieurs jours : jeton d'accès périmé, renouvellement au lancement. */
function staleSession(refreshToken: string) {
  return JSON.stringify({ access_token: 'at-old', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 86400, refresh_token: refreshToken, user });
}

/** localStorage du WebView : lecture/écriture en mémoire, copie sur « disque » seulement si l'app vit assez longtemps. */
function webViewLocalStorage(diskStore: Map<string, string>) {
  const memory = new Map(diskStore);
  const storage: SupportedStorage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => { memory.set(k, v); },
    removeItem: (k) => { memory.delete(k); },
  };
  return { storage, flushToDisk: () => { diskStore.clear(); memory.forEach((v, k) => diskStore.set(k, v)); } };
}

async function launchApp(storage: SupportedStorage, fetch: typeof globalThis.fetch, storageKey = KEY) {
  const client = createClient(URL_, 'anon', { auth: { storage, storageKey, autoRefreshToken: true, detectSessionInUrl: false }, global: { fetch } });
  client.auth.onAuthStateChange((event) => trackAuthEvent(event)); // comme supabaseClient.ts
  const { data } = await client.auth.getSession();
  await client.auth.stopAutoRefresh();
  return data.session;
}

describe('Session Supabase après un arrêt brutal de l\'app (Android)', () => {
  beforeEach(() => {
    invoke.mockImplementation(vaultImpl);
    captureMessage.mockReset();
    resetAuthStorageReports();
    disk.clear();
    localStorage.clear();
    resetAuthSessionWatch();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useRealTimers();
  });

  /** Quelques jours sans ouvrir l'app : le jeton d'accès enregistré est périmé au lancement suivant. */
  const daysLater = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 86400_000);
  };

  it('AVANT (localStorage du WebView) : l\'app tuée juste après un renouvellement perd la session', async () => {
    const server = fakeServer();
    const webDisk = new Map([[KEY, staleSession('rt-0')]]);

    // Lancement 1 : renouvellement (rt-0 → rt-1), puis app tuée avant l'écriture différée
    const run1 = webViewLocalStorage(webDisk);
    expect((await launchApp(run1.storage, server.fetch))?.refresh_token).toBe('rt-1');

    // Lancement 2, des jours plus tard : le disque a encore rt-0, refusé par le serveur
    daysLater();
    const run2 = webViewLocalStorage(webDisk);
    expect(await launchApp(run2.storage, server.fetch)).toBeNull();
    // La page de connexion dira « session expirée » au lieu d'un retour muet
    expect(wasSessionLost()).toBe(true);
  });

  it('localStorage du WebView écrit sur disque à temps : la session survit (le défaut tient au délai d\'écriture)', async () => {
    const server = fakeServer();
    const webDisk = new Map([[KEY, staleSession('rt-0')]]);
    const run1 = webViewLocalStorage(webDisk);
    await launchApp(run1.storage, server.fetch);
    run1.flushToDisk();
    daysLater();
    expect((await launchApp(webViewLocalStorage(webDisk).storage, server.fetch))?.refresh_token).toBe('rt-2');
  });

  it('APRÈS (coffre Android) : la session renouvelée survit à l\'arrêt brutal', async () => {
    const server = fakeServer();
    disk.set(`supabase-auth::${KEY}`, staleSession('rt-0'));

    expect((await launchApp(createDurableAuthStorage(), server.fetch))?.refresh_token).toBe('rt-1');
    // Rien d'autre que le coffre ne survit à l'arrêt : lancement 2, des jours plus tard
    daysLater();
    const session = await launchApp(createDurableAuthStorage(), server.fetch);
    expect(session?.refresh_token).toBe('rt-2');
    expect(server.validToken()).toBe('rt-2');
    expect(wasSessionLost()).toBe(false);
  });

  it('Mise à jour depuis une version qui gardait la session dans le localStorage : reprise sans reconnexion', async () => {
    const server = fakeServer();
    localStorage.setItem(KEY, staleSession('rt-0'));

    const session = await launchApp(createDurableAuthStorage(), server.fetch);
    expect(session?.refresh_token).toBe('rt-1');
    expect(JSON.parse(disk.get(`supabase-auth::${KEY}`) as string).refresh_token).toBe('rt-1');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  /** Lancement avec temps simulé : les réessais d'écriture du coffre attendent un peu. */
  async function launchAppWithTimers(storage: SupportedStorage, fetch: typeof globalThis.fetch, storageKey: string) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const pending = launchApp(storage, fetch, storageKey);
      await vi.advanceTimersByTimeAsync(10_000);
      return await pending;
    } finally {
      vi.useRealTimers();
    }
  }

  /** Coffre qui refuse les `failures` premières écritures (Keystore momentanément indisponible). */
  function vaultRefusingWrites(failures: number) {
    let refused = 0;
    invoke.mockImplementation(async (cmd: string, args: { key: string; value?: string }) => {
      if (cmd === 'plugin:nyx-android|secure_set' && refused < failures) {
        refused++;
        throw new Error('Keystore indisponible');
      }
      return vaultImpl(cmd, args);
    });
  }

  it('Coffre momentanément indisponible à l\'écriture du renouvellement, la session n\'est pas perdue', async () => {
    // Clé propre au test : les clients des tests précédents ne reçoivent pas ses événements
    const KEY = 'sb-projet-b45a-auth-token';
    const server = fakeServer();
    disk.set(`supabase-auth::${KEY}`, staleSession('rt-0'));
    vaultRefusingWrites(1);

    // Le serveur a remplacé rt-0 par rt-1 : rt-1 doit arriver dans le coffre malgré l'échec
    expect((await launchAppWithTimers(createDurableAuthStorage(), server.fetch, KEY))?.refresh_token).toBe('rt-1');
    expect(JSON.parse(disk.get(`supabase-auth::${KEY}`) as string).refresh_token).toBe('rt-1');

    // Lancement suivant, des jours plus tard : toujours connecté
    invoke.mockImplementation(vaultImpl);
    daysLater();
    // (wasSessionLost n'est pas lu ici : les clients des tests précédents, réveillés par le temps
    // simulé, émettent leurs propres événements)
    expect((await launchApp(createDurableAuthStorage(), server.fetch, KEY))?.refresh_token).toBe('rt-2');
  });

  it('Coffre indisponible plus longtemps, l\'app garde la session renouvelée et l\'enregistre dès que le coffre répond', async () => {
    // Clé propre au test : les clients des tests précédents ne reçoivent pas ses événements
    const KEY = 'sb-projet-b45b-auth-token';
    const server = fakeServer();
    disk.set(`supabase-auth::${KEY}`, staleSession('rt-0'));
    vaultRefusingWrites(3);

    const storage = createDurableAuthStorage();
    expect((await launchAppWithTimers(storage, server.fetch, KEY))?.refresh_token).toBe('rt-1');
    expect(captureMessage).toHaveBeenCalledWith('Session Supabase non enregistrée sur l\'appareil', expect.anything());
    // Pas encore sur le disque, mais l'app lit bien rt-1 (et jamais l'ancien rt-0, déjà refusé)
    expect(await storage.getItem(KEY)).toContain('rt-1');
    // Le coffre répond de nouveau (lecture suivante) : rt-1 y est enregistré
    await vi.waitFor(() => expect(JSON.parse(disk.get(`supabase-auth::${KEY}`) as string).refresh_token).toBe('rt-1'));

    daysLater();
    expect((await launchApp(createDurableAuthStorage(), server.fetch, KEY))?.refresh_token).toBe('rt-2');
  });

  it('coffre illisible au lancement : écran de connexion ce coup-ci, mais la session reste dans le coffre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const server = fakeServer();
    disk.set(`supabase-auth::${KEY}`, staleSession('rt-0'));
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:nyx-android|secure_get') throw new Error('Keystore indisponible');
      throw new Error(`écriture inattendue ${cmd}`);
    });
    const client = createClient(URL_, 'anon', { auth: { storage: createDurableAuthStorage(), storageKey: KEY, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: server.fetch } });
    const events: string[] = [];
    client.auth.onAuthStateChange((event, session) => { events.push(`${event}:${session ? 'session' : 'aucune'}`); });
    const read = client.auth.getSession();
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await read).data.session).toBeNull();
    // L'app n'attend pas indéfiniment : INITIAL_SESSION arrive (sans session)
    expect(events).toContain('INITIAL_SESSION:aucune');
    expect(disk.has(`supabase-auth::${KEY}`)).toBe(true);
    expect(server.fetch).not.toHaveBeenCalled();
  });
});
