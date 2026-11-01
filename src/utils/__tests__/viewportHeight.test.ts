import { describe, it, expect } from 'vitest';
import { createKeyboardDetector } from '../viewportHeight';

describe('createKeyboardDetector', () => {
  it('signale le clavier quand la hauteur fond pour une même largeur', () => {
    const detect = createKeyboardDetector();
    expect(detect(360, 732)).toBe(false);
    expect(detect(360, 420)).toBe(true);
    expect(detect(360, 732)).toBe(false);
  });

  it('ignore les petites variations (barres système)', () => {
    const detect = createKeyboardDetector();
    expect(detect(360, 732)).toBe(false);
    expect(detect(360, 780)).toBe(false);
    expect(detect(360, 700)).toBe(false);
  });

  it('repart de la nouvelle hauteur après une rotation', () => {
    const detect = createKeyboardDetector();
    expect(detect(360, 732)).toBe(false);
    // Lecteur en paysage : plus basse, mais ce n'est pas un clavier
    expect(detect(780, 360)).toBe(false);
    expect(detect(360, 732)).toBe(false);
  });
});
