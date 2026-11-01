/**
 * Fonctions serveur Supabase (supabase/functions) : seulement une syntaxe TypeScript « effaçable ».
 *
 * Bug constaté : le déploiement du relais TMDB échouait sur une « erreur interne » de Supabase, alors
 * que delete-account (mêmes dépendances) passait. Seule différence : un paramètre de constructeur
 * `constructor(public status …)` dans tmdb-proxy. L'assembleur de Supabase se contente d'effacer les
 * types et refuse ce qui génère du code (paramètres de constructeur, enum, namespace, import =…).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(__dirname, '../../../supabase/functions');

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSources(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

/**
 * Constructions TypeScript qui produisent du JavaScript (et ne s'effacent donc pas) : le compilateur
 * les signale lui-même avec l'option erasableSyntaxOnly (erreur 1294).
 */
function nonErasableSyntax(code: string): string[] {
  const fileName = 'fonction.ts';
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    name === fileName ? ts.createSourceFile(name, code, version, true) : getSourceFile(name, version);
  const program = ts.createProgram(
    [fileName],
    { erasableSyntaxOnly: true, noEmit: true, noLib: true, noResolve: true, types: [] },
    host,
  );
  const file = program.getSourceFile(fileName)!;
  return program
    .getSemanticDiagnostics(file)
    .concat(program.getSyntacticDiagnostics(file))
    .filter((d) => d.code === 1294)
    .map((d) => `ligne ${file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} : ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

describe('fonctions serveur Supabase : syntaxe effaçable', () => {
  it('repère un paramètre de constructeur (le cas du relais TMDB), un enum, un import =', () => {
    expect(nonErasableSyntax('class E extends Error { constructor(public status: number) { super(); } }')).toHaveLength(1);
    expect(nonErasableSyntax('enum Couleur { Rouge }')).toHaveLength(1);
    expect(nonErasableSyntax('declare global { interface X { a: number } }\nexport {};')).toEqual([]);
    expect(nonErasableSyntax('class E extends Error { status: number; constructor(s: number) { super(); this.status = s; } }')).toEqual([]);
  });

  const sources = listSources(root);
  it('trouve les fonctions', () => {
    expect(sources.length).toBeGreaterThanOrEqual(3);
  });

  it.each(sources.map((path) => [relative(root, path), path]))('%s', (_name, path) => {
    expect(nonErasableSyntax(readFileSync(path, 'utf8'))).toEqual([]);
  });
});
