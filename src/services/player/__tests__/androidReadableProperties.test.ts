/**
 * Android : le plugin ne laisse lire que les propriétés du lecteur dont l'interface se sert
 * (`PlayerInputPolicy.READABLE_PROPERTIES`, Kotlin), comme le lecteur Windows. Une propriété lue par
 * l'interface et oubliée dans cette liste serait refusée sur le téléphone et la TV : ce test lit les
 * deux côtés.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../../..');
const POLICY = resolve(
  SRC,
  '../src-tauri/plugins/tauri-plugin-nyx-android/android/src/main/java/com/nyxplayer/nativebridge/PlayerInputPolicy.kt',
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function readableOnAndroid(): Set<string> {
  const text = readFileSync(POLICY, 'utf8');
  const block = /READABLE_PROPERTIES = setOf\(([\s\S]*?)\)/.exec(text)?.[1] ?? '';
  return new Set([...block.matchAll(/"([a-z0-9/-]+)"/g)].map((m) => m[1]));
}

/** Propriétés lues par l'interface : `getProperty('x')` et les listes de `observeProperties([...])`. */
function readByTheInterface(): Set<string> {
  const names = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/getProperty\(\s*'([a-z0-9/-]+)'/g)) names.add(m[1]);
    for (const m of text.matchAll(/observe(?:Android)?Properties\(\s*\[([^\]]*)\]/g)) {
      for (const n of m[1].matchAll(/'([a-z0-9/-]+)'/g)) names.add(n[1]);
    }
  }
  return names;
}

describe('propriétés du lecteur lisibles sur Android', () => {
  it('la liste du plugin est lue', () => {
    expect(readableOnAndroid().size).toBeGreaterThan(20);
  });

  it("chaque propriété lue par l'interface est permise par le plugin", () => {
    const allowed = readableOnAndroid();
    const read = readByTheInterface();
    expect(read.size).toBeGreaterThan(15);
    expect([...read].filter((name) => !allowed.has(name))).toEqual([]);
  });
});
