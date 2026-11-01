/**
 * Fonctions serveur (supabase/functions) : quelles origines ont le droit de les appeler.
 *
 * Sous Linux, la WebView de Tauri a l'origine `tauri://localhost`. Absente de la liste, le
 * navigateur bloquait chaque réponse : toutes les listes TMDB échouaient, et la suppression du
 * compte aussi. Windows (`http://tauri.localhost`), Android et `tauri dev` ne doivent pas changer.
 * Les deux fonctions partagent la même liste (`_shared/cors.ts`).
 *
 * Une fonction tourne sous Deno (imports jsr:/npm:), elle ne s'importe pas ici : on lit dans son
 * fichier comment elle obtient ses en-têtes CORS, et on exécute ce code tel quel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { corsHeaders } from '../../../supabase/functions/_shared/cors';

type GetCors = (req: Request) => Record<string, string>;

function loadCors(fn: string): GetCors {
  const source = readFileSync(resolve(__dirname, `../../../supabase/functions/${fn}/index.ts`), 'utf8').replace(/\r\n/g, '\n');
  const shared = /const getCorsHeaders = \(req: Request\) => corsHeaders\(req, "([^"]+)"\);/.exec(source);
  if (shared) {
    expect(source).toContain('import { corsHeaders } from "../_shared/cors.ts";');
    return (req) => corsHeaders(req, shared[1]);
  }
  // Liste propre à la fonction : exécutée telle quelle
  const start = source.indexOf('const ALLOWED_ORIGINS');
  const fnStart = source.indexOf('function getCorsHeaders', start);
  const end = source.indexOf('\n}\n', fnStart);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(fnStart).toBeGreaterThan(start);
  const js = ts.transpileModule(`${source.slice(start, end + 2)}\nreturn getCorsHeaders;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return new Function(js)() as GetCors;
}

describe.each([
  ['tmdb-proxy', 'GET, OPTIONS'],
  ['delete-account', 'POST, OPTIONS'],
])('fonction %s : origines autorisées (CORS)', (fn, methods) => {
  const getCorsHeaders = loadCors(fn);
  const allowFor = (origin: string) =>
    getCorsHeaders(new Request(`https://x.supabase.co/functions/v1/${fn}`, { headers: { Origin: origin } }));

  it.each([
    ['http://tauri.localhost', 'Windows / Android'],
    ['https://tauri.localhost', 'variante HTTPS'],
    ['http://localhost:1420', 'tauri dev'],
    ['tauri://localhost', 'Linux (banc de tests)'],
  ])('renvoie %s tel quel (%s)', (origin) => {
    expect(allowFor(origin)['Access-Control-Allow-Origin']).toBe(origin);
  });

  it('refuse une autre origine en renvoyant une origine qui ne correspond pas', () => {
    expect(allowFor('https://evil.example')['Access-Control-Allow-Origin']).toBe('http://tauri.localhost');
    expect(allowFor('tauri://evil')['Access-Control-Allow-Origin']).toBe('http://tauri.localhost');
  });

  it('annonce ses propres méthodes', () => {
    expect(allowFor('http://tauri.localhost')['Access-Control-Allow-Methods']).toBe(methods);
  });
});
