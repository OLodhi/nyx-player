/**
 * Journaux des fonctions serveur Supabase (supabase/functions) : jamais le texte d'une erreur.
 *
 * Quand un appel réseau interne échoue,
 * le message d'erreur cite l'adresse appelée, donc la recherche TMDB ou l'identifiant du compte
 * supprimé (`…/auth/v1/admin/users/<uuid>`). Les journaux gardent le nom de l'erreur et son statut.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(__dirname, '../../../supabase/functions');

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/** Appels `console.*(…)` du fichier, parenthèses équilibrées (un appel peut tenir sur plusieurs lignes). */
function consoleCalls(code: string): string[] {
  const calls: string[] = [];
  for (const match of code.matchAll(/console\.(?:log|info|warn|error|debug)\(/g)) {
    let depth = 0;
    let end = match.index;
    for (; end < code.length; end++) {
      if (code[end] === '(') depth++;
      if (code[end] === ')' && --depth === 0) break;
    }
    calls.push(code.slice(match.index, end + 1));
  }
  return calls;
}

describe('fonctions serveur Supabase : journaux sans texte d\'erreur', () => {
  it('repère un message d\'erreur cité, même sur plusieurs lignes', () => {
    expect(consoleCalls('console.error("x:", error.message);')).toHaveLength(1);
    expect(consoleCalls('console.error(\n  "x",\n  err instanceof Error ? err.message : "?",\n);')[0]).toContain('.message');
  });

  const sources = listSources(root);
  it.each(sources.map((path) => [relative(root, path), path]))('%s', (_name, path) => {
    const leaks = consoleCalls(readFileSync(path, 'utf8')).filter((call) => /\.message\b|String\(err|\$\{err/.test(call));
    expect(leaks).toEqual([]);
  });
});
