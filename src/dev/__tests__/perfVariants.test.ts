/**
 * Variantes de la version de mesure : elles forcent un réglage pour le comparer à celui de la TV, sans rien changer
 * quand aucune n'est cochée. Seuls les témoins utiles à un futur travail de fluidité restent.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyVariants, PERF_VARIANTS } from '../perfVariants';

describe('variantes gardées', () => {
  it('les témoins de l’accueil TV, de « Voir tout » et le flou, rien d’autre', () => {
    expect(PERF_VARIANTS.map((v) => v.id).sort()).toEqual(['no-blur', 'poster-old-img', 'posters-original', 'rail-legacy', 'see-all-before']);
  });

  it('chaque règle du CSS de mesure vise une variante qui existe, sous la TV seulement', () => {
    const css = readFileSync(resolve(__dirname, '../perfVariants.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const ids = new Set(PERF_VARIANTS.map((v) => v.id));
    const selectors = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].flatMap(([, selector]) => selector.split(','));
    expect(selectors.length).toBeGreaterThan(0);
    for (const one of selectors) {
      const match = /^:root\.nyx-tv\.nyx-perf-([a-z-]+) /.exec(one.trim());
      expect(match, one).not.toBeNull();
      expect(ids.has(match![1] as never), one).toBe(true);
    }
  });

  it('une variante cochée pose sa classe sur la page, décochée la retire', () => {
    applyVariants(new Set(['no-blur']));
    expect(document.documentElement).toHaveClass('nyx-perf-no-blur');
    applyVariants(new Set());
    expect(document.documentElement).not.toHaveClass('nyx-perf-no-blur');
  });
});

describe('témoin des mesures de l’accueil TV', () => {
  it('« rail d’avant » rend l’ancien rail à l’ouverture suivante de l’accueil ; sans lui, le rail retenu', async () => {
    const rail = await import('../../components/Iptv/rail/rail');
    const legacy = vi.spyOn(rail, 'setLegacyRail');
    applyVariants(new Set(['rail-legacy']));
    expect(legacy).toHaveBeenLastCalledWith(true);
    applyVariants(new Set());
    expect(legacy).toHaveBeenLastCalledWith(false);
    legacy.mockRestore();
  });
});
