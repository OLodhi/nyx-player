/**
 * Guide TV à la télécommande : la ligne de la chaîne sélectionnée est centrée dans le corps du guide,
 * y compris quand la page est réduite à l'écran (une ancienne réduction de 0,9, retirée depuis).
 */

import { describe, it, expect } from 'vitest';
import { channelCenterOffset } from '../useGuideTvRemote';

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

/** Corps du guide haut de 500 px (mise en page), vu à l'écran réduit de `scale`, en haut à 100 px. */
function guideBody(scale: number): HTMLElement {
  const body = document.createElement('div');
  Object.defineProperty(body, 'offsetHeight', { value: 500 });
  Object.defineProperty(body, 'clientHeight', { value: 500 });
  body.getBoundingClientRect = () => rect(100, 500 * scale);
  return body;
}

describe('centrage de la ligne du guide', () => {
  it('sans réduction : écart entre le centre de la case et celui du corps', () => {
    // Case de 40 px à 600 px du haut du corps : centre à 620, centre du corps à 250
    expect(channelCenterOffset(guideBody(1), rect(100 + 600, 40))).toBeCloseTo(370, 6);
  });

  it('page réduite à 0,9 (TV) : même défilement en pixels de mise en page', () => {
    // Avant : 308 au lieu de 370, la ligne visée tombait sous le centre du corps
    const s = 0.9;
    expect(channelCenterOffset(guideBody(s), rect(100 + 600 * s, 40 * s))).toBeCloseTo(370, 6);
  });
});
