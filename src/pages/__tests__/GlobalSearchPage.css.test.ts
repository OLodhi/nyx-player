import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/pages/GlobalSearchPage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const bloc = (sel: string) => new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
const horizontal = (padding: string) => {
  const [, right, , left] = padding.trim().split(/\s+(?![^(]*\))/);
  return { left, right };
};

describe('GlobalSearchPage.css', () => {
  it("le message « Commencez à taper » est centré sous le champ, pas sur toute la largeur (barre latérale comprise)", () => {
    const header = /padding:\s*([^;]+);/.exec(bloc('.search-header'))?.[1] ?? '';
    const message = /padding:\s*([^;]+);/.exec(bloc('.no-results'))?.[1] ?? '';
    expect(message).not.toBe('');
    expect(horizontal(message)).toEqual(horizontal(header));
  });
});
