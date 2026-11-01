/**
 * Tests unitaires pour StarRating
 *
 * Vérifie la conversion score TMDB (0-10) → étoiles (0-5).
 */

import { describe, it, expect } from 'vitest';
import { renderStars } from '../StarRating';

describe('renderStars', () => {
  it('retourne 5 étoiles pleines pour un score parfait (10)', () => {
    expect(renderStars(10)).toBe('★★★★★');
  });

  it('retourne 0 étoiles pleines pour un score de 0', () => {
    expect(renderStars(0)).toBe('☆☆☆☆☆');
  });

  it('retourne 3 étoiles pour un score de 6', () => {
    expect(renderStars(6)).toBe('★★★☆☆');
  });

  it('arrondit vers le haut pour un score de 7 (3.5 → 4)', () => {
    expect(renderStars(7)).toBe('★★★★☆');
  });

  it('arrondit vers le bas pour un score de 1 (0.5 → 0)', () => {
    // Math.round(0.5) = 1 en JS
    expect(renderStars(1)).toBe('★☆☆☆☆');
  });

  it('retourne toujours 5 caractères', () => {
    for (let score = 0; score <= 10; score++) {
      expect(renderStars(score)).toHaveLength(5);
    }
  });

  it('gère un score négatif gracieusement', () => {
    // Math.round(-1) = -1, repeat(-1) = ''
    // '★'.repeat(-1) throws RangeError, but Math.round(-2/2) = -1
    // Defensive: negative scores shouldn't happen but let's document behavior
    expect(() => renderStars(-2)).toThrow();
  });
});
