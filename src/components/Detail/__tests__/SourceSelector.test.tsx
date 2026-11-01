/**
 * Menu des sources d'une fiche : sur TV, un nom de source très long le faisait passer sur deux
 * lignes. Le menu porte la classe `source-selector`, que la surcouche TV utilise pour le garder sur
 * une ligne de largeur bornée ; le nom entier reste dans la liste ouverte.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SourceSelector from '../SourceSelector';

const longName = 'FR | Le Seigneur des anneaux : la communauté de l’anneau (version longue) 4K HDR';
const versions = [
  { id: 1, name: longName },
  { id: 2, name: 'FR | HD' },
];

describe('SourceSelector', () => {
  it('ne s’affiche pas avec une seule source', () => {
    const { container } = render(
      <SourceSelector versions={[versions[0]]} selectedId={1} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('porte la classe source-selector, en plus de celle du parent', () => {
    const { container } = render(
      <SourceSelector versions={versions} selectedId={1} onSelect={vi.fn()} className="version-selector" />,
    );
    const root = container.querySelector('.nyx-dropdown');
    expect(root?.classList.contains('source-selector')).toBe(true);
    expect(root?.classList.contains('version-selector')).toBe(true);
  });

  it('affiche le nom entier de la source choisie (la coupe est seulement visuelle)', () => {
    const { container } = render(<SourceSelector versions={versions} selectedId={1} onSelect={vi.fn()} />);
    expect(container.querySelector('.nyx-dropdown__value')?.textContent).toBe(longName);
  });
});

describe('surcouche TV du menu des sources', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  };

  it('garde le nom de la source choisie sur une seule ligne', () => {
    const value = rule('.nyx-tv .source-selector .nyx-dropdown__value');
    expect(value).toMatch(/white-space:\s*nowrap/);
    expect(value).toMatch(/text-overflow:\s*ellipsis/);
    expect(value).toMatch(/overflow:\s*hidden/);
  });

  it('borne la largeur du menu et laisse le bouton rétrécir', () => {
    expect(rule('.nyx-tv .source-selector')).toMatch(/max-width:/);
    expect(rule('.nyx-tv .source-selector .nyx-dropdown__trigger')).toMatch(/min-width:\s*0/);
  });
});
