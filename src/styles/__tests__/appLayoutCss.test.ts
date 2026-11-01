/**
 * Garde-fou de la mise en page bureau (src/App.css).
 *
 * `main` est l'élément flexible à droite de la barre latérale. Sans `min-width: 0`, sa largeur
 * minimale automatique vaut celle de son contenu dès que le moteur ne le traite plus comme une
 * boîte de défilement (WebView2 récent) : la bannière d'accueil prenait ~5700 px de large
 * dans une fenêtre de 2000 px, image géante et pointillés hors écran.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Corps de la règle dont le sélecteur est exactement `selector`. */
const ruleBody = (selector: string): string | undefined =>
  [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === selector)?.[2];

describe('App.css — conteneur principal', () => {
  it('borne la largeur de main à la fenêtre (min-width: 0)', () => {
    const body = ruleBody('main');
    expect(body).toBeDefined();
    expect(body).toMatch(/(^|;)\s*min-width:\s*0\s*;/);
  });
});
