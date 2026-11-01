/**
 * Le français n'a plus de repli sur l'anglais (charger l'anglais en plus à chaque lancement
 * annulerait le gain du chargement par langue). Chaque clé doit donc exister dans les deux langues,
 * sinon l'écran afficherait le nom de la clé.
 */
import { describe, expect, it } from 'vitest';
import fr from '../locales/fr';
import en from '../locales/en';
import { NAMESPACES } from '../config';

function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('textes français et anglais', () => {
  it('couvrent les mêmes espaces que la configuration', () => {
    expect(Object.keys(fr).sort()).toEqual([...NAMESPACES].sort());
    expect(Object.keys(en).sort()).toEqual([...NAMESPACES].sort());
  });

  it.each([...NAMESPACES])('%s : mêmes clés dans les deux langues', (ns) => {
    expect(keys(fr[ns]).sort()).toEqual(keys(en[ns]).sort());
  });

  // En anglais, le bouton Lecture de la bannière d'accueil disait « Resume », comme s'il y avait
  // une reprise, sur un compte où rien n'avait été regardé. C'est le bouton Lecture (qui reprend tout
  // seul s'il y a une progression), comme sur la fiche, pas un bouton Reprendre.
  it('Bouton Lecture de la bannière, même texte que sur la fiche', () => {
    expect(en.dashboard.play).toBe(en.details.play);
    expect(fr.dashboard.play).toBe(fr.details.play);
  });
});
