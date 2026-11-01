/**
 * La synchro règle les conflits par « la date la plus récente gagne ». Datées par
 * l'horloge de l'appareil, les modifications d'une box réglée 2 jours dans le futur gagnaient tous
 * les conflits. L'app apprend l'heure du serveur sur les réponses de Supabase (serverClock.ts) et
 * date ses modifications synchronisées avec elle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';

// Requêtes Supabase de la synchro simulées : chaque envoi est noté
type Call = { table: string; args: unknown[] };
const calls: Call[] = [];
function builder(table: string) {
  const call: Call = { table, args: [] };
  const b = {
    upsert: (...args: unknown[]) => { call.args = args; return b; },
    then: (resolve: (r: { error: null }) => unknown) => { calls.push(call); return Promise.resolve({ error: null }).then(resolve); },
  };
  return b;
}
vi.mock('../../supabaseClient', () => ({ supabase: { from: (table: string) => builder(table) } }));
vi.mock('../syncBaseline', () => ({ currentGeneration: () => 1, updateBaseline: vi.fn(async () => {}) }));

import { setCurrentSyncUserId } from '../syncState';
import { pushPreferenceToCloud, pushPlaybackUpsertToCloud } from '../syncPush';
import { createAuthGuardedFetch, resetAuthRefreshGuard } from '../../authRefreshGuard';
import {
  createServerClockFetch, recordServerTime, resetServerClock, serverClockOffset, serverNow,
} from '../serverClock';

const DAY = 24 * 60 * 60 * 1000;
/** Heure réelle (celle du serveur) pendant le test. */
const SERVER_NOW = Date.UTC(2026, 9, 12, 10, 0, 0);
/** Horloge de la box : 2 jours d'avance. */
const BOX_NOW = SERVER_NOW + 2 * DAY;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Jeton d'accès factice, émis par le serveur à `iatMs`. */
function accessToken(iatMs: number): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'u1', iat: Math.floor(iatMs / 1000), exp: Math.floor(iatMs / 1000) + 3600 })}.signature`;
}

/** Réponse REST de Supabase, datée par le serveur (en-tête `Date`) quand `withDate`. */
function restResponse(withDate: boolean): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withDate) headers.Date = new Date(SERVER_NOW).toUTCString();
  return new Response('[]', { status: 200, headers });
}

beforeEach(() => {
  calls.length = 0;
  resetServerClock();
  resetAuthRefreshGuard();
  setCurrentSyncUserId('u1');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'], now: BOX_NOW });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('box dont l’horloge avance de 2 jours', () => {
  it('une préférence modifiée part au cloud à l’heure du serveur, pas à celle de la box', async () => {
    // Une réponse de Supabase datée par le serveur est passée par le client (synchro, profil…)
    const clockFetch = createServerClockFetch(async () => restResponse(true));
    await clockFetch('https://projet.supabase.co/rest/v1/user_preferences?select=*');

    pushPreferenceToCloud('lang', 'fr');
    await flush();

    const [row] = calls[0].args as [{ updated_at: string }];
    expect(Math.abs(Date.parse(row.updated_at) - SERVER_NOW)).toBeLessThan(1000);
  });

  it('une reprise sans date locale part aussi à l’heure du serveur', async () => {
    recordServerTime(SERVER_NOW);
    pushPlaybackUpsertToCloud(42, 'movie', { title: 'Film', time_seconds: 600, duration_seconds: 6000 });
    await flush();

    const [row] = calls[0].args as [{ updated_at: string }];
    expect(Date.parse(row.updated_at)).toBe(SERVER_NOW);
  });

  it('sans en-tête Date lisible : l’heure vient du jeton du renouvellement de session (vrai client Supabase)', async () => {
    const url = 'https://projet.supabase.co';
    const key = 'sb-projet-b17-auth-token';
    const user = { id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
    // Session renouvelée il y a 30 min (heure du serveur) : périmée pour la box, qui la renouvelle
    const stored = JSON.stringify({ access_token: accessToken(SERVER_NOW - 30 * 60_000), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(SERVER_NOW / 1000) + 1800, refresh_token: 'rt-0', user });
    const data = new Map([[key, stored]]);
    const storage: SupportedStorage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => { data.set(k, v); },
      removeItem: (k) => { data.delete(k); },
    };
    // Faux serveur : aucune réponse ne laisse lire son en-tête Date (cas d'un WebView en CORS)
    const server = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/token?grant_type=refresh_token')) {
        return new Response(JSON.stringify({ access_token: accessToken(SERVER_NOW), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(SERVER_NOW / 1000) + 3600, refresh_token: 'rt-1', user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    // Client construit comme dans supabaseClient.ts
    const client = createClient(url, 'anon', {
      auth: { storage, storageKey: key, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: createAuthGuardedFetch(createServerClockFetch(server)) },
    });

    const { data: { session } } = await client.auth.getSession();
    await flush();

    expect(session?.refresh_token).toBe('rt-1');
    expect(Math.abs(serverNow() - SERVER_NOW)).toBeLessThan(1000);
    pushPreferenceToCloud('lang', 'fr');
    await flush();
    const [row] = calls[0].args as [{ updated_at: string }];
    expect(Math.abs(Date.parse(row.updated_at) - SERVER_NOW)).toBeLessThan(1000);
  });
});

describe('serverClock', () => {
  it('sans écart connu : l’horloge de l’appareil, comme avant', () => {
    expect(serverClockOffset()).toBeNull();
    expect(serverNow()).toBe(BOX_NOW);
  });

  it('une réponse sans en-tête Date ni jeton n’apprend rien, et la réponse est rendue intacte', async () => {
    const clockFetch = createServerClockFetch(async () => restResponse(false));
    const response = await clockFetch('https://projet.supabase.co/rest/v1/x');
    expect(await response.text()).toBe('[]');
    expect(serverClockOffset()).toBeNull();
  });

  it('le corps d’une réponse /token reste lisible par Supabase', async () => {
    const body = JSON.stringify({ access_token: accessToken(SERVER_NOW) });
    const clockFetch = createServerClockFetch(async () => new Response(body, { status: 200 }));
    const response = await clockFetch('https://projet.supabase.co/auth/v1/token?grant_type=password');
    expect(await response.text()).toBe(body);
    await flush();
    expect(Math.abs(serverNow() - SERVER_NOW)).toBeLessThan(1000);
  });

  it('un jeton illisible ou une réponse /token en erreur n’apprennent rien', async () => {
    await createServerClockFetch(async () => new Response(JSON.stringify({ access_token: 'pas-un-jeton' }), { status: 200 }))('https://p.supabase.co/auth/v1/token?grant_type=refresh_token');
    await createServerClockFetch(async () => new Response(JSON.stringify({ access_token: accessToken(SERVER_NOW) }), { status: 400 }))('https://p.supabase.co/auth/v1/token?grant_type=refresh_token');
    await flush();
    expect(serverClockOffset()).toBeNull();
  });

  it('un écart invraisemblable (plus d’un an) est ignoré', () => {
    expect(recordServerTime(BOX_NOW - 400 * DAY)).toBe(false);
    expect(recordServerTime(Number.NaN)).toBe(false);
    expect(serverNow()).toBe(BOX_NOW);
  });

  it('les mesures proches sont lissées, un saut de plus d’une minute remplace l’écart', () => {
    recordServerTime(BOX_NOW - 10_000);
    expect(serverClockOffset()).toBe(-10_000);
    recordServerTime(BOX_NOW - 14_000);
    expect(serverClockOffset()).toBe(-11_000);
    // Horloge de la box avancée de 2 jours entre-temps
    recordServerTime(BOX_NOW - 2 * DAY);
    expect(serverClockOffset()).toBe(-2 * DAY);
  });

  it('un en-tête Date ancien (réponse en cache) ne remplace pas un écart appris par le jeton', async () => {
    recordServerTime(SERVER_NOW);
    const stale = new Response('[]', { status: 200, headers: { Date: new Date(SERVER_NOW - 3 * 60 * 60 * 1000).toUTCString() } });
    await createServerClockFetch(async () => stale)('https://projet.supabase.co/rest/v1/x');
    expect(Math.abs(serverNow() - SERVER_NOW)).toBeLessThan(1000);
  });

  it('une lecture de l’heure qui échoue rend quand même la réponse', async () => {
    const response = restResponse(true);
    vi.spyOn(response.headers, 'get').mockImplementation(() => { throw new Error('en-têtes illisibles'); });
    const returned = await createServerClockFetch(async () => response)('https://projet.supabase.co/rest/v1/x');
    expect(returned).toBe(response);
    expect(serverClockOffset()).toBeNull();
  });

  it('seul le chemin /auth/v1/token est lu comme une réponse de jeton', async () => {
    const body = JSON.stringify({ access_token: accessToken(SERVER_NOW) });
    await createServerClockFetch(async () => new Response(body, { status: 200 }))('https://projet.supabase.co/rest/v1/x?q=/auth/v1/token');
    await flush();
    expect(serverClockOffset()).toBeNull();
  });

  it('une box en retard reçoit aussi l’heure du serveur', () => {
    recordServerTime(BOX_NOW + 3 * DAY);
    expect(serverNow()).toBe(BOX_NOW + 3 * DAY);
  });
});
