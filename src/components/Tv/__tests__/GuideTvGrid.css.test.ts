import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('GuideTvGrid.css', () => {
  it('rangées et cellules de chaîne contenues (contain: layout style), sans rogner le contour de focus', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Tv/GuideTvGrid.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.guide-tv-grid__row', '.guide-tv-grid__channel-cell']) {
      const bloc = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(bloc).toMatch(/contain:\s*layout style\s*;/);
    }
    expect(css).not.toMatch(/contain:[^;]*paint/);
  });
});
