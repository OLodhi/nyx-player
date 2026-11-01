/**
 * Fonctions serveur Supabase : seul un compte connecté peut les appeler.
 * Tout jeton signé par le projet passait, y compris une connexion anonyme ou une autre audience.
 * Les connexions anonymes sont désactivées en production ; ce contrôle ne dépend plus de ce réglage.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { isSignedInAccount } from '../../../supabase/functions/_shared/tokenClaims';

describe('jeton : compte connecté seulement', () => {
  it('accepte un compte connecté', () => {
    expect(isSignedInAccount({ aud: 'authenticated', is_anonymous: false })).toBe(true);
    expect(isSignedInAccount({ aud: ['authenticated'] })).toBe(true);
  });

  it('refuse une connexion anonyme, une autre audience ou un jeton sans audience', () => {
    expect(isSignedInAccount({ aud: 'authenticated', is_anonymous: true })).toBe(false);
    expect(isSignedInAccount({ aud: 'autre' })).toBe(false);
    expect(isSignedInAccount({})).toBe(false);
  });
});

// delete-account exécuté tel quel (transpilé), avec une fausse vérification de jeton et une fausse
// API d'administration : on regarde seulement si la suppression est demandée.
const ISSUER = 'https://projet.supabase.co/auth/v1';
const now = () => Math.floor(Date.now() / 1000);
const TOKENS: Record<string, () => Record<string, unknown>> = {
  compte: () => ({ sub: 'a', iss: ISSUER, aud: 'authenticated', amr: [{ method: 'password', timestamp: now() }] }),
  anonyme: () => ({
    sub: 'x', iss: ISSUER, aud: 'authenticated', is_anonymous: true, amr: [{ method: 'password', timestamp: now() }],
  }),
};

function loadModule(path: string, external: Record<string, unknown>, globals: Record<string, unknown>) {
  const js = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const localRequire = (spec: string) => {
    if (spec in external) return external[spec];
    if (spec.startsWith('.')) return loadModule(resolve(dirname(path), spec), external, globals);
    throw new Error(`import inattendu : ${spec}`);
  };
  const names = Object.keys(globals);
  new Function('exports', 'require', 'module', ...names, js)(module.exports, localRequire, module, ...names.map((n) => globals[n]));
  return module.exports;
}

function loadDeleteAccount() {
  const deleted: string[] = [];
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  loadModule(
    resolve(__dirname, '../../../supabase/functions/delete-account/index.ts'),
    {
      'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
      'npm:@supabase/supabase-js@2': {
        createClient: () => ({ auth: { admin: { deleteUser: async (id: string) => { deleted.push(id); return { error: null }; } } } }),
      },
      'jsr:@panva/jose@6': {
        createRemoteJWKSet: () => ({}),
        jwtVerify: async (token: string, _keys: unknown, options: { audience?: string }) => {
          const payload = TOKENS[token]?.();
          if (!payload) throw new Error('signature');
          if (options.audience !== undefined && payload.aud !== options.audience) throw new Error('audience');
          return { payload };
        },
      },
    },
    {
      Deno: { env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://projet.supabase.co' : undefined) }, serve: (h: typeof handler) => { handler = h; } },
      console: silent,
    },
  );
  const serve = handler!;
  const call = (token: string) =>
    serve(new Request('https://projet.supabase.co/delete-account', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }));
  return { call, deleted };
}

describe('delete-account : compte connecté seulement', () => {
  it('supprime le compte appelant avec un jeton normal (inchangé)', async () => {
    const fn = loadDeleteAccount();
    expect((await fn.call('compte')).status).toBe(200);
    expect(fn.deleted).toEqual(['a']);
  });

  it('refuse une connexion anonyme', async () => {
    const fn = loadDeleteAccount();
    expect((await fn.call('anonyme')).status).toBe(401);
    expect(fn.deleted).toEqual([]);
  });
});
