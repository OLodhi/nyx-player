// @vitest-environment node
// Windows (comme macOS par défaut) ne distingue pas les majuscules dans les noms de fichiers. Deux fichiers d'un
// même dossier dont les noms ne diffèrent que par la casse s'y confondent : « Carte.tsx » et « carte.ts »
// font qu'un import « ./Carte » tombe sur le mauvais fichier, et la compilation échoue sur le PC seulement,
// jamais sous Linux. Règle : dans un dossier, deux chemins (ou deux modules, extension de code retirée) ne
// diffèrent jamais seulement par la casse.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const fichiers = execFileSync('git', ['-C', racine, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

/** Groupes de noms distincts qui se confondent une fois en minuscules, selon une clé donnée. */
export function confusions(chemins, cle) {
  const groupes = new Map();
  for (const chemin of chemins) {
    const k = cle(chemin).toLowerCase();
    const groupe = groupes.get(k) ?? new Set();
    groupe.add(cle(chemin));
    groupes.set(k, groupe);
  }
  return [...groupes.values()].filter((g) => g.size > 1).map((g) => [...g].sort());
}

const sansExtensionDeCode = (chemin) => chemin.replace(/\.(d\.ts|tsx?|jsx?|mjs|cjs)$/, '');

describe('noms de fichiers sous Windows', () => {
  it('aucun chemin ne diffère d’un autre seulement par la casse', () => {
    expect(confusions(fichiers, (f) => f)).toEqual([]);
  });

  it('aucun module ne diffère d’un autre seulement par la casse (import sans extension)', () => {
    expect(confusions(fichiers, sansExtensionDeCode)).toEqual([]);
  });

  it('repère le cas d’un composant et de sa logique au même nom', () => {
    expect(confusions(['src/a/Carte.tsx', 'src/a/carte.ts', 'src/b/carte.ts'], sansExtensionDeCode)).toEqual([['src/a/Carte', 'src/a/carte']]);
  });
});
