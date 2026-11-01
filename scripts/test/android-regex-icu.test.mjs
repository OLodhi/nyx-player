// @vitest-environment node
// Regex Kotlin/Java compatibles avec Android. Android compile les regex avec ICU, qui lit « [: »
// comme le début d'une propriété Unicode « [:nom:] » ; le JVM des tests Kotlin l'accepte comme un
// simple deux-points. Une regex `[:=]` passait donc les tests et plantait l'app au lancement
// (StreamDiagnostics, septembre 2026). Écrire `[=:]` ou `[\:=]` à la place.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../src-tauri', import.meta.url));
const skipped = new Set(['target', 'build', '.gradle', 'node_modules', '.cxx']);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : sources(full);
    return /\.(kt|kts|java)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Un « [: » non échappé (précédé d'un nombre pair de barres obliques inverses). ICU y voit une
 * propriété Unicode dès qu'un « :] » suit plus loin, même des années après ; on l'interdit donc partout.
 */
function icuPropertyOpeners(text) {
  return text
    .split('\n')
    .flatMap((line, index) => (/(?<!\\)(?:\\\\)*\[:/.test(line) ? [index + 1] : []));
}

describe('regex Android (ICU)', () => {
  it('repère la regex qui plantait au lancement', () => {
    expect(icuPropertyOpeners('Regex("""(\\s*[:=]\\s*|\\s+)""")')).toEqual([1]);
    expect(icuPropertyOpeners('Regex("""(\\s*[=:]\\s*|\\s+)""")')).toEqual([]);
    expect(icuPropertyOpeners('Regex("""(\\s*[\\:=]\\s*|\\s+)""")')).toEqual([]);
    expect(icuPropertyOpeners('Regex("""x\\\\[:=]a""")')).toEqual([1]);
  });

  it('aucun fichier Kotlin/Java ne contient « [: »', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(0);
    const hits = files.flatMap((file) =>
      icuPropertyOpeners(readFileSync(file, 'utf8')).map(
        (line) => `${path.relative(root, file)}:${line}`,
      ),
    );
    expect(hits).toEqual([]);
  });
});
