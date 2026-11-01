/**
 * inert.ts — Retirer un bloc monté mais fermé du parcours du focus.
 *
 * Un panneau qui glisse hors de l'écran à la fermeture (listes de chaînes et d'épisodes du lecteur)
 * reste dans le DOM pour son animation : ses boutons restaient atteignables à la télécommande, au
 * clavier (Tab) et par la navigation directionnelle (`spatialNavigation/` saute tout bloc `inert`).
 * React 18 ne connaît pas l'attribut `inert` : il est passé en chaîne, qui traverse telle quelle.
 * **Avec React 19**, `inert` devient un booléen et `''` vaudrait faux : passer alors à `inert: true`
 * (le test `inert.test.tsx` le signalerait).
 */

import type React from 'react';

export function inertProps(inert: boolean): React.HTMLAttributes<HTMLElement> {
  return (inert ? { inert: '' } : {}) as React.HTMLAttributes<HTMLElement>;
}
