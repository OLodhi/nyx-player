/**
 * Bandeau « base de l'appareil abîmée » (LocalDatabaseDamagedNotice), sur un téléphone :
 * - téléphone : texte et bouton côte à côte, le bouton prenait 60 % de la largeur et le texte tombait
 *   en une colonne étroite aux mots coupés (« enregistré/es ») → le bouton passe sous le texte ;
 * - TV : le bandeau poussait « Se déconnecter » sous le bas de la toile de 720 px → écran resserré ;
 * - erreur de chargement des profils : bandeau collé aux bords de l'écran → largeur bornée.
 * Mesuré dans Chromium sur les vraies feuilles (360 px : texte de 70 px → 277 px ; TV : bas de
 * « Se déconnecter » 810 px → 667 px). Ici, la présence des règles qui portent ces mesures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Déclarations de la règle dont le sélecteur est exactement `selector` (espaces normalisés). */
function declarations(css: string, selector: string): Record<string, string> {
  const rules = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)];
  const rule = rules.find((m) => m[1].trim().replace(/\s+/g, ' ') === selector);
  if (!rule) return {};
  return Object.fromEntries(
    rule[2].split(';').map((d) => d.split(':')).filter((d) => d.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join(':').trim()]),
  );
}

describe('bandeau « base de l\'appareil abîmée »', () => {
  const mobile = read('src/styles/mobile.css');
  const tv = read('src/styles/tv.css');
  const app = read('src/App.css');

  it('téléphone : le bouton passe sous le texte, sur toute la largeur', () => {
    expect(declarations(mobile, '.nyx-mobile .local-db-notice')['flex-wrap']).toBe('wrap');
    expect(declarations(mobile, '.nyx-mobile .local-db-notice__text')).toMatchObject({ flex: '1 1 0', 'min-width': '0' });
    expect(declarations(mobile, '.nyx-mobile .local-db-notice__reset')['flex-basis']).toBe('100%');
  });

  it('TV : écran resserré quand le bandeau est affiché, bandeau à la largeur de l\'écran', () => {
    expect(declarations(tv, '.nyx-tv .profile-selector__content--db-damaged').gap).toBeDefined();
    expect(declarations(tv, '.nyx-tv .profile-selector__db-damaged')['max-width']).toBe('none');
    expect(declarations(tv, '.nyx-tv .profile-error-db-notice').width).toContain('--tv-safe-x');
  });

  it('erreur de chargement des profils : bandeau de largeur bornée, écarté des bords', () => {
    expect(declarations(app, '.profile-error-db-notice')).toMatchObject({ 'max-width': '36rem', 'text-align': 'start' });
  });
});
