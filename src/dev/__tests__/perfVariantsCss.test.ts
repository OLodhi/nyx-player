/**
 * Nyx Mesure : la compilation de la version de mesure (`VITE_PERF=1`) échouait, car
 * `import('./perfVariants.css')` créait un bloc chargé à la demande porteur de son propre CSS, ce
 * que le build refuse (vite.config.ts, forbid-lazy-chunk-css). La version normale n'était pas
 * touchée : ce code y disparaît. Les styles des variantes passent désormais en texte (`?inline`).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('CSS chargé à la demande', () => {
  it("aucun fichier de src n'importe un CSS brut à la demande (le build le refuserait)", () => {
    const fautifs = sourceFiles(SRC).filter((file) =>
      /import\(\s*['"][^'"]+\.css['"]\s*\)/.test(readFileSync(file, 'utf8')),
    );
    expect(fautifs).toEqual([]);
  });
});

describe('variantes de fluidité de Nyx Mesure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete window.__nyxPerfVariants;
    localStorage.removeItem('nyx-perf-variants');
    document.head.querySelectorAll('style[data-nyx-perf-variants]').forEach((el) => el.remove());
  });

  it('posent leurs styles dans une balise <style> en version de mesure', async () => {
    vi.stubEnv('VITE_PERF', '1');
    vi.resetModules();
    await import('../perfVariants');
    await vi.waitFor(() => expect(document.head.querySelector('style[data-nyx-perf-variants]')).not.toBeNull());
  });

  it('ne posent rien dans la version normale', async () => {
    vi.stubEnv('VITE_PERF', '');
    vi.resetModules();
    await import('../perfVariants');
    await new Promise((r) => setTimeout(r, 20));
    expect(document.head.querySelector('style[data-nyx-perf-variants]')).toBeNull();
  });
});
