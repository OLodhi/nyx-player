/**
 * Garde-fou : aucun lien de l'interface ne fait naviguer la fenêtre de l'app vers un autre site.
 * La fenêtre donne à la page qu'elle affiche l'accès aux commandes natives (secrets, base, requêtes
 * au fournisseur) ; sur Android, un lien `target="_blank"` s'ouvre dans cette même fenêtre. Tout
 * lien externe passe par `openExternalLink` (navigateur de l'appareil) : chaque `<a href>` porte donc
 * un `onClick`, et aucun n'a de `target`.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SRC = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

/** Liens `<a>` fautifs d'un fichier : `fichier:ligne raison`. */
function faultyLinks(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const faults: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'a') {
      const names = node.attributes.properties
        .filter(ts.isJsxAttribute)
        .map((attr) => attr.name.getText());
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const where = `${relative(SRC, file)}:${line}`;
      if (names.includes('target')) faults.push(`${where} target`);
      if (names.includes('href') && !names.includes('onClick')) faults.push(`${where} href sans onClick`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return faults;
}

describe('liens externes', () => {
  it('le garde-fou repère un lien target="_blank" et un href sans onClick', () => {
    const faults = faultyLinks(
      join(SRC, 'exemple.tsx'),
      'const A = () => <div><a href="https://example.com" target="_blank">x</a><a href={u} /></div>;',
    );
    expect(faults).toEqual(['exemple.tsx:1 target', 'exemple.tsx:1 href sans onClick', 'exemple.tsx:1 href sans onClick']);
  });

  it("aucun lien de src ne fait naviguer la fenêtre de l'app", () => {
    const faults = sourceFiles(SRC).flatMap((file) => faultyLinks(file, readFileSync(file, 'utf8')));
    expect(faults).toEqual([]);
  });
});
