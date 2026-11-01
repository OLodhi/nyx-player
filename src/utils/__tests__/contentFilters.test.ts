/**
 * Tests unitaires pour contentFilters.ts
 *
 * Vérifie la détection de scripts exotiques (arabe, hébreu, CJK, etc.)
 * et l'intégration avec le paramètre isEnabled.
 */

import { describe, it, expect } from 'vitest';
import { EXOTIC_SCRIPT_REGEX, isExoticName } from '../contentFilters';

describe('EXOTIC_SCRIPT_REGEX', () => {
  // --- Scripts détectés (doit matcher) ---
  describe('détecte les scripts exotiques', () => {
    it('détecte l\'arabe', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('فيلم جديد')).toBe(true);
    });

    it('détecte l\'hébreu', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('סרט חדש')).toBe(true);
    });

    it('détecte le CJK (chinois)', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('电影 Movie')).toBe(true);
    });

    it('détecte le devanagari (hindi)', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('फिल्म')).toBe(true);
    });

    it('détecte le bengali', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('সিনেমা')).toBe(true);
    });

    it('détecte le thaï', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('ภาพยนตร์')).toBe(true);
    });

    it('détecte un mélange latin + arabe', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('Movie مترجم')).toBe(true);
    });
  });

  // --- Scripts non-détectés (ne doit PAS matcher) ---
  describe('ignore les scripts latins et cyrilliques', () => {
    it('ignore le latin pur', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('The Matrix 1999')).toBe(false);
    });

    it('ignore le latin avec accents', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('Les Misérables')).toBe(false);
    });

    it('ignore le cyrillique', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('Матрица')).toBe(false);
    });

    it('ignore les chiffres et symboles', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('Movie 2024 (4K) [HEVC]')).toBe(false);
    });

    it('ignore une chaîne vide', () => {
      expect(EXOTIC_SCRIPT_REGEX.test('')).toBe(false);
    });
  });
});

describe('isExoticName', () => {
  it('retourne false si le filtre est désactivé même avec du texte exotique', () => {
    expect(isExoticName('فيلم عربي', false)).toBe(false);
  });

  it('retourne true si le filtre est activé ET le texte contient des scripts exotiques', () => {
    expect(isExoticName('فيلم عربي', true)).toBe(true);
  });

  it('retourne false si le filtre est activé mais le texte est latin', () => {
    expect(isExoticName('The Matrix', true)).toBe(false);
  });

  it('retourne false si le filtre est activé mais le texte est vide', () => {
    expect(isExoticName('', true)).toBe(false);
  });

  it('retourne true pour un mix latin+arabe quand le filtre est actif', () => {
    expect(isExoticName('Movie مترجم HD', true)).toBe(true);
  });

  it('retourne false pour du cyrillique quand le filtre est actif', () => {
    expect(isExoticName('Матрица Перезагрузка', true)).toBe(false);
  });
});
