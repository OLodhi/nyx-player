/**
 * « Votre session a expiré » sur le téléphone après 1 ou 2 jours sans ouvrir Nyx.
 *
 * Avec le vrai client Supabase : au lancement, le jeton d'accès est périmé et Supabase renouvelle la
 * session. Une réponse en erreur qui ne vient pas du serveur d'authentification (page d'un portail
 * Wi-Fi, blocage Cloudflare, limite de requêtes) effaçait la session alors que le jeton de
 * renouvellement était encore bon.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

const captureMessage = vi.fn();
vi.mock('@sentry/react', () => ({ captureMessage: (...args: unknown[]) => captureMessage(...args) }));

import { createAuthGuardedFetch, recentRefreshFailure, resetAuthRefreshGuard } from '../authRefreshGuard';
import { trackAuthEvent, wasSessionLost, resetAuthSessionWatch } from '../authSessionWatch';

const URL_ = 'https://projet.supabase.co';
let currentTest = 0;
/** Clé propre à chaque test : les clients des tests finis ne reçoivent pas ses événements (BroadcastChannel). */
const key = () => `sb-projet${currentTest}-auth-token`;
const REFRESH_URL = `${URL_}/auth/v1/token?grant_type=refresh_token`;
const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', email: 'w@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };

/** Session enregistrée la veille : jeton d'accès périmé, renouvellement au lancement. */
const staleSession = () => JSON.stringify({ access_token: 'at-old', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 86400, refresh_token: 'rt-0', user });

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const html = (status: number) => new Response('<html><body>Attention Required! | Cloudflare</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
const renewed = () => json({ access_token: 'at-1', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt-1', user }, 200);

function memoryStorage(): { storage: SupportedStorage; data: Map<string, string> } {
  const data = new Map([[key(), staleSession()]]);
  return {
    data,
    storage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => { data.set(k, v); },
      removeItem: (k) => { data.delete(k); },
    },
  };
}

/** Lancement de l'app : le client est construit comme dans supabaseClient.ts. */
async function launch(storage: SupportedStorage, fetch: typeof globalThis.fetch) {
  const client = createClient(URL_, 'anon', { auth: { storage, storageKey: key(), autoRefreshToken: true, detectSessionInUrl: false }, global: { fetch } });
  client.auth.onAuthStateChange((event) => trackAuthEvent(event));
  // Supabase réessaie une panne réseau pendant une trentaine de secondes : temps simulé
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    const read = client.auth.getSession();
    await vi.advanceTimersByTimeAsync(60_000);
    const { data } = await read;
    await client.auth.stopAutoRefresh();
    return data.session;
  } finally {
    vi.useRealTimers();
  }
}


/** Faux serveur : les `failures` premières demandes de renouvellement reçoivent `failure`, les suivantes réussissent. */
function server(failure: () => Response, failures = Infinity) {
  let calls = 0;
  const test = currentTest;
  return vi.fn(async (input: RequestInfo | URL) => {
    // Les clients d'un test fini réessaient encore : coupés du réseau pour ne pas brouiller le suivant
    if (test !== currentTest) throw new TypeError('test terminé');
    if (String(input).includes('/token?grant_type=refresh_token')) return ++calls <= failures ? failure() : renewed();
    return json({}, 404);
  });
}

describe('Renouvellement de session au lancement', () => {
  beforeEach(() => {
    currentTest++;
    resetAuthSessionWatch();
    resetAuthRefreshGuard();
    captureMessage.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('AVANT : une page HTML 403 (Cloudflare, portail Wi-Fi) efface la session', async () => {
    const { storage, data } = memoryStorage();
    expect(await launch(storage, server(() => html(403)))).toBeNull();
    expect(data.has(key())).toBe(false);
    expect(wasSessionLost()).toBe(true);
  });

  it('APRÈS : page HTML 403 au renouvellement, la session est gardée', async () => {
    const { storage, data } = memoryStorage();
    // Pas de session à l'écran tant que le blocage dure (comme hors ligne), mais rien d'effacé :
    // elle revient seule au renouvellement suivant (SupabaseAuthContext prépare alors le compte)
    expect(await launch(storage, createAuthGuardedFetch(server(() => html(403))))).toBeNull();
    expect(JSON.parse(data.get(key()) as string).refresh_token).toBe('rt-0');
    expect(wasSessionLost()).toBe(false);
    // Signalé une seule fois à Sentry malgré les essais répétés, sans « session perdue »
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0][0]).toContain('réponse inattendue');
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ tags: { auth_refresh_status: '403', auth_refresh_code: 'aucun' } });
  });

  it('APRÈS : limite de requêtes (429) au renouvellement, la session est gardée', async () => {
    const { storage, data } = memoryStorage();
    await launch(storage, createAuthGuardedFetch(server(() => json({ code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, 429))));
    expect(data.has(key())).toBe(true);
    expect(wasSessionLost()).toBe(false);
  });

  it('APRÈS : réponse 400 vide ou illisible, la session est gardée', async () => {
    const { storage, data } = memoryStorage();
    await launch(storage, createAuthGuardedFetch(server(() => new Response('', { status: 400 }))));
    expect(data.has(key())).toBe(true);
    expect(wasSessionLost()).toBe(false);
  });

  it('blocage passager : Supabase réessaie aussitôt et la session est renouvelée', async () => {
    const { storage, data } = memoryStorage();
    expect((await launch(storage, createAuthGuardedFetch(server(() => html(403), 1))))?.refresh_token).toBe('rt-1');
    expect(JSON.parse(data.get(key()) as string).refresh_token).toBe('rt-1');
    expect(wasSessionLost()).toBe(false);
  });

  it('blocage prolongé : session gardée, renouvelée à un lancement suivant', async () => {
    const { storage, data } = memoryStorage();
    let blocked = true;
    const fetch = createAuthGuardedFetch(server(() => (blocked ? html(403) : renewed())));
    await launch(storage, fetch);
    blocked = false;
    expect((await launch(storage, fetch))?.refresh_token).toBe('rt-1');
    expect(JSON.parse(data.get(key()) as string).refresh_token).toBe('rt-1');
  });

  it('vrai refus du serveur (jeton introuvable) : session effacée, cause dans le journal et Sentry', async () => {
    const { storage, data } = memoryStorage();
    const refused = () => json({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
    expect(await launch(storage, createAuthGuardedFetch(server(refused)))).toBeNull();
    expect(data.has(key())).toBe(false);
    expect(wasSessionLost()).toBe(true);
    expect(recentRefreshFailure()).toMatchObject({ status: 400, code: 'refresh_token_not_found', definitive: true });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({
      level: 'warning',
      tags: { auth_refresh_status: '400', auth_refresh_code: 'refresh_token_not_found', auth_refresh_definitive: 'true' },
    });
    expect(String(captureMessage.mock.calls[0][0])).not.toContain('rt-0');
  });

  it('Vrai refus, Sentry dit depuis quand la session enregistrée n\'avait pas été renouvelée', async () => {
    const { storage } = memoryStorage();
    const refused = () => json({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
    // Session renouvelée il y a 25 h (jeton d'accès d'une heure, périmé depuis 24 h)
    const fetch = createAuthGuardedFetch(server(refused), { readStoredSession: async () => storage.getItem(key()) });
    await launch(storage, fetch);
    expect(recentRefreshFailure()).toMatchObject({ sessionAgeHours: 25 });
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ tags: { auth_session_age_h: '25' } });
  });

  it('Âge de la session inconnu (illisible ou absente) : « inconnu », jamais d\'erreur', async () => {
    const { storage } = memoryStorage();
    const refused = () => json({ code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, 400);
    const fetch = createAuthGuardedFetch(server(refused), { readStoredSession: async () => { throw new Error('coffre'); } });
    expect(await launch(storage, fetch)).toBeNull();
    expect(wasSessionLost()).toBe(true);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ tags: { auth_session_age_h: 'inconnu' } });
  });

  it('vrai refus du serveur (jeton déjà utilisé, ancien code error_code) : session effacée', async () => {
    const { storage } = memoryStorage();
    await launch(storage, createAuthGuardedFetch(server(() => json({ error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' }, 400))));
    expect(wasSessionLost()).toBe(true);
  });
});

describe('createAuthGuardedFetch', () => {
  beforeEach(() => {
    resetAuthRefreshGuard();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('autres requêtes Supabase : réponses en erreur transmises telles quelles', async () => {
    const response = html(403);
    const guarded = createAuthGuardedFetch(vi.fn(async () => response));
    expect(await guarded(`${URL_}/rest/v1/profiles?select=*`)).toBe(response);
    expect(recentRefreshFailure()).toBeNull();
  });

  it('renouvellement réussi : réponse transmise, rien de noté', async () => {
    const response = renewed();
    const guarded = createAuthGuardedFetch(vi.fn(async () => response));
    expect(await guarded(new Request(REFRESH_URL, { method: 'POST' }))).toBe(response);
    expect(recentRefreshFailure()).toBeNull();
  });

  it('un renouvellement réussi efface l\'échec noté avant lui', async () => {
    let fail = true;
    const guarded = createAuthGuardedFetch(vi.fn(async () => (fail ? html(403) : renewed())));
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(recentRefreshFailure()).not.toBeNull();
    fail = false;
    await guarded(REFRESH_URL);
    expect(recentRefreshFailure()).toBeNull();
  });

  it('un échec ancien n\'explique plus une déconnexion ; une panne du serveur (5xx) n\'est pas signalée à Sentry', async () => {
    captureMessage.mockReset();
    const guarded = createAuthGuardedFetch(vi.fn(async () => html(502)));
    await expect(guarded(REFRESH_URL)).rejects.toThrow(TypeError);
    expect(recentRefreshFailure()).toMatchObject({ status: 502, code: null, definitive: false });
    expect(recentRefreshFailure(Date.now() + 120_000)).toBeNull();
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
