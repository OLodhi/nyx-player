/**
 * Fiches film et série remontées à chaque nouveau titre : leur
 * état (source choisie, fiche TMDB, saison) est initialisé une seule fois. Une fiche série sans
 * `key` gardait l'ancienne série quand une autre était ouverte par-dessus (retour arrière d'une
 * série vers une autre). Ce garde-fou lit App.tsx.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Fins de ligne Windows (core.autocrlf) ramenées à \n : la recherche porte sur `<Nom\n`
const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8').replace(/\r\n/g, '\n');

/** Attributs de la balise ouvrante `<Nom …>` dans App.tsx */
function openingTag(name: string): string {
  const start = app.indexOf(`<${name}\n`);
  expect(start).toBeGreaterThan(-1);
  return app.slice(start, app.indexOf('>', app.indexOf('onBack', start)));
}

describe('fiches film et série remontées à chaque titre', () => {
  it('la fiche série a une clé tirée de la série ouverte', () => {
    expect(openingTag('SeriesDetailPage')).toMatch(/key=\{[^}]*selectedSeries\.series_id/);
  });

  it('la fiche film garde la sienne', () => {
    expect(openingTag('MovieDetailPage')).toMatch(/key=\{[^}]*selectedMovie\.tmdbId/);
  });
});
