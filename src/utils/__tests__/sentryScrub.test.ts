import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as Sentry from '@sentry/react';
import type { ErrorEvent } from '@sentry/react';
import { MASKED_HOST, scrubBreadcrumb, scrubEvent, scrubText, scrubValue, sentryPrivacyOptions } from '../sentryScrub';

const LEAK = 'Request failed: error sending request for url (http://h.com:8080/player_api.php?username=john&password=secret&action=get_live_streams)';

function expectClean(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toContain('john');
  expect(text).not.toContain('secret');
}

describe('sentryScrub', () => {
  it('nettoie la copie brute des arguments console des miettes', () => {
    const b = scrubBreadcrumb({
      category: 'console',
      message: `Login/Fetch failed: ${LEAK}`,
      data: { arguments: ['Login/Fetch failed:', LEAK, new Error(LEAK)], logger: 'console' },
    });
    expectClean(b);
    expect(b.data?.logger).toBe('console');
  });

  it('nettoie les miettes réseau', () => {
    const b = scrubBreadcrumb({ category: 'fetch', data: { url: 'http://h.com/live/john/secret/1.ts', status_code: 200 } });
    expectClean(b);
    expect(b.data?.status_code).toBe(200);
  });

  it("nettoie le message, l'exception, extra, les miettes et la requête d'un événement", () => {
    const event = {
      type: undefined,
      message: LEAK,
      user: { id: 'u' },
      exception: { values: [{ type: 'Error', value: LEAK }] },
      extra: { reason: LEAK, nested: { list: [LEAK] } },
      contexts: { app: { lastUrl: 'http://h.com/movie/john/secret/2.mkv' } },
      breadcrumbs: [{ message: LEAK, data: { arguments: [LEAK] } }],
      request: { url: 'http://h.com/get.php?username=john&password=secret', query_string: 'username=john&password=secret' },
    } as unknown as ErrorEvent;
    const out = scrubEvent(event);
    expectClean(out);
    expect(out.user).toBeUndefined();
    expect(out.exception?.values?.[0].type).toBe('Error');
  });

  it('laisse intactes les valeurs sans identifiant', () => {
    expect(scrubValue({ a: 1, b: true, c: null, d: 'https://api.themoviedb.org/3/movie/550' })).toEqual({
      a: 1, b: true, c: null, d: 'https://api.themoviedb.org/3/movie/550',
    });
  });
});

// Moins de données envoyées à Sentry (hôte du fournisseur, paramètres Supabase, jetons, retours)
describe('sentryScrub — moins de données', () => {
  const PROVIDER = 'http://iptv.monfournisseur.example:8080/live/john/secret/12345.ts';
  const SUPABASE = 'https://abcd.supabase.co/rest/v1/watch_progress?select=*&user_id=eq.3f2b1c4d-1111-2222-3333-444455556666';
  const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';

  it("masque l'hôte du fournisseur et le numéro du flux, garde le type d'appel", () => {
    const out = scrubText(`loadfile → ${PROVIDER}`);
    expect(out).toBe(`loadfile → http://${MASKED_HOST}/live/…`);
    expect(scrubText('http://1.2.3.4:25461/player_api.php?username=a&password=b&action=get_vod'))
      .toBe(`http://${MASKED_HOST}/player_api.php?[…]`);
    expect(scrubText('http://john:secret@host.example/x')).toBe(`http://${MASKED_HOST}/…`);
    expect(scrubText('http://short.example:8080/john/secret/99')).not.toMatch(/short|john|secret|99/);
  });

  it('retire les paramètres Supabase mais garde la table', () => {
    const out = scrubText(`GET ${SUPABASE} 401`);
    expect(out).toBe('GET https://abcd.supabase.co/rest/v1/watch_progress?[…] 401');
    expect(scrubText('https://abcd.supabase.co/auth/v1/callback#access_token=abc&refresh_token=def'))
      .toBe('https://abcd.supabase.co/auth/v1/callback?[…]');
  });

  it("masque jetons, identifiants de compte, e-mails et adresses IP hors adresse", () => {
    const out = scrubText(
      `Bearer ${JWT} token=${JWT} profil 3f2b1c4d-1111-2222-3333-444455556666 de jean.dupont@mail.fr sur 192.0.2.20:8080`,
    );
    expect(out).toBe('Bearer [jeton] token=[…] profil [id] de [e-mail] sur [ip]');
  });

  it("garde ce qui sert au diagnostic : type d'erreur, versions, adresses de l'app et de TMDB", () => {
    expect(scrubText('[v0.7.6] database is locked')).toBe('[v0.7.6] database is locked');
    expect(scrubText('Chrome/120.0.6099.109')).toBe('Chrome/120.0.6099.109');
    expect(scrubText('http://ipc.localhost/plugin%3Asql%7Cexecute')).toBe('http://ipc.localhost/plugin%3Asql%7Cexecute');
    expect(scrubText('https://api.themoviedb.org/3/movie/550?api_key=k&language=fr'))
      .toBe('https://api.themoviedb.org/3/movie/550?[…]');
  });

  it('filtre les clés secrètes et nettoie la requête', () => {
    const b = scrubBreadcrumb({
      category: 'fetch',
      data: { url: SUPABASE, method: 'GET', status_code: 401, headers: { Authorization: `Bearer ${JWT}`, apikey: 'k' } },
    });
    expect(JSON.stringify(b)).not.toMatch(/eq\.|3f2b1c4d|eyJ|"k"/);
    expect(b.data?.method).toBe('GET');
    expect(b.data?.status_code).toBe(401);

    const event = scrubEvent({
      request: { url: SUPABASE, query_string: 'user_id=eq.x', cookies: { a: 'b' }, headers: { 'User-Agent': 'UA', Referer: PROVIDER } },
    } as unknown as ErrorEvent);
    expect(event.request).toEqual({ url: 'https://abcd.supabase.co/rest/v1/watch_progress?[…]', headers: { 'User-Agent': 'UA' } });
  });
});

// Chaîne complète avec le vrai client Sentry et les réglages de main.tsx : ce qui part réellement
describe('sentryScrub — envoi réel (client Sentry)', () => {
  const sent: string[] = [];

  beforeAll(() => {
    Sentry.init({
      dsn: 'https://public@o0.ingest.sentry.io/0',
      defaultIntegrations: false,
      transport: (options) => Sentry.createTransport(options, async (request) => {
        sent.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body));
        return { statusCode: 200 };
      }),
      ...sentryPrivacyOptions(),
    });
  });

  afterAll(async () => {
    await Sentry.close();
  });

  it("nettoie le texte de « Signaler un problème » sans perdre la version ni le sens", async () => {
    Sentry.addBreadcrumb({ category: 'fetch', data: { url: 'https://abcd.supabase.co/rest/v1/profiles?id=eq.3f2b1c4d-1111-2222-3333-444455556666' } });
    Sentry.captureFeedback({
      message: '[v0.7.6] La chaîne http://john:secret@iptv.monfournisseur.example:8080/live/john/secret/12345.ts coupe, écrivez-moi à jean@mail.fr',
      name: 'Testeur',
    });
    await Sentry.flush(1000);
    const body = sent.join('\n');
    expect(body).toContain('[v0.7.6] La chaîne');
    expect(body).toContain('coupe, écrivez-moi à [e-mail]');
    expect(body).not.toMatch(/monfournisseur|john|secret|12345|jean@mail|3f2b1c4d|id=eq/);
  });

  it("nettoie une erreur et garde son type et l'écran", async () => {
    sent.length = 0;
    Sentry.captureException(new TypeError('error sending request for url (http://iptv.monfournisseur.example/player_api.php?username=john&password=secret)'), {
      extra: { context: 'Player' },
    });
    await Sentry.flush(1000);
    const body = sent.join('\n');
    expect(body).toContain('TypeError');
    expect(body).toContain('"context":"Player"');
    expect(body).not.toMatch(/monfournisseur|john|secret/);
  });
});

// Cas limites (longs textes, adresses encodées, IPv6, hôtes sans schéma, piles)
describe('sentryScrub — cas limites', () => {
  it('reste rapide sur un très long texte (pas d’emballement des expressions)', () => {
    const start = performance.now();
    scrubText('a'.repeat(200_000));
    scrubText('a.'.repeat(100_000));
    scrubText(`${'x'.repeat(50_000)}@`);
    expect(performance.now() - start).toBeLessThan(500);
    expect(scrubText('b'.repeat(20_000)).length).toBeLessThan(10_100);
  });

  it('masque les adresses encodées, IPv6 et les hôtes sans schéma', () => {
    const cases = [
      'url=http%3A%2F%2Fiptv.provider.tv%3A8080%2Flive%2Fjohn%2Fsecret%2F12345.ts',
      '{"u":"http:\\/\\/iptv.provider.tv:8080\\/live\\/john\\/secret\\/12345.ts"}',
      'http://[2001:db8::1]:8080/live/john/secret/12345.ts',
      'Failed to resolve hostname iptv.provider.tv',
      'connect to iptv.provider.tv:8080 refused',
    ];
    for (const c of cases) expect(scrubText(c)).not.toMatch(/provider|john|secret|12345|2001:db8/);
  });

  it('masque les clés et mots de passe écrits en clair', () => {
    const out = scrubText(`"password": "hunter2" x-api-key: abc sb_secret_AbC123 Authorization: Token t0k3n eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0`);
    expect(out).not.toMatch(/hunter2|abc\b|AbC123|t0k3n|eyJ/);
  });

  it('garde les noms de fichiers de code, les paquets et les adresses de l’app', () => {
    expect(scrubText('at render (index-BtQwiVLR.js:430:12)')).toBe('at render (index-BtQwiVLR.js:430:12)');
    expect(scrubText('tauri://localhost/assets/index-x.js:430:12')).toBe('tauri://localhost/assets/index-x.js:430:12');
    expect(scrubText('react@18.2.0')).toBe('react@18.2.0');
    expect(scrubText('http://evil.localhost.provider.tv/x')).toBe(`http://${MASKED_HOST}/…`);
  });

  it('retire le chemin des adresses localhost et 127.0.0.1 (proxy IPTV local possible)', () => {
    expect(scrubText('erreur http://localhost/John/Secret/123')).toBe('erreur http://localhost/…');
    expect(scrubText('http://127.0.0.1/John/Secret/123.ts?x=1')).toBe('http://127.0.0.1/…?[…]');
    expect(scrubText('http://localhost:34400/auto/v1')).toBe('http://localhost:34400/…');
    expect(scrubText('http://localhost/')).toBe('http://localhost/');
    // Pages et appels de l'app : chemin gardé
    expect(scrubText('http://tauri.localhost/assets/index-x.js')).toBe('http://tauri.localhost/assets/index-x.js');
    expect(scrubText('http://asset.localhost/C%3A/x.png')).toBe('http://asset.localhost/C%3A/x.png');
  });

  it('nettoie les cadres de pile et les données du mécanisme', () => {
    const event = scrubEvent({
      exception: { values: [{ type: 'Error', mechanism: { type: 'generic', data: { url: 'http://iptv.provider.tv/live/a/b/1.ts' } },
        stacktrace: { frames: [{ filename: 'http://iptv.provider.tv/x.js', abs_path: 'tauri://localhost/assets/index.js' }] } }] },
    } as unknown as ErrorEvent);
    const text = JSON.stringify(event);
    expect(text).not.toContain('provider');
    expect(text).toContain('tauri://localhost/assets/index.js');
  });
});
