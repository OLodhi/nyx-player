/**
 * Tests unitaires pour itemHelpers.ts
 *
 * @module itemHelpers.test
 */

import { describe, it, expect } from 'vitest';
import { cleanTitle } from '../itemHelpers';

describe('cleanTitle', () => {
  it('supprime les préfixes de langue', () => {
    expect(cleanTitle('FR - Matrix')).toBe('Matrix');
    expect(cleanTitle('EN - Avatar')).toBe('Avatar');
    expect(cleanTitle('MULTI - Inception')).toBe('Inception');
    expect(cleanTitle('VF: Interstellar')).toBe('Interstellar');
  });

  it('supprime les suffixes de qualité', () => {
    expect(cleanTitle('Matrix 4K')).toBe('Matrix');
    expect(cleanTitle('Avatar UHD')).toBe('Avatar');
    expect(cleanTitle('Inception 1080p')).toBe('Inception');
    expect(cleanTitle('Interstellar HEVC')).toBe('Interstellar');
  });

  it("supprime l'année en fin de titre", () => {
    expect(cleanTitle('Matrix (1999)')).toBe('Matrix');
    expect(cleanTitle('Avatar 2009')).toBe('Avatar');
  });

  it('combine les suppressions', () => {
    expect(cleanTitle('FR - Matrix 4K (1999)')).toBe('Matrix');
    expect(cleanTitle('MULTI - Avatar UHD 2009')).toBe('Avatar');
  });

  it('gère les chaînes vides', () => {
    expect(cleanTitle('')).toBe('');
  });

  it('préserve les titres déjà propres', () => {
    expect(cleanTitle('The Matrix')).toBe('The Matrix');
    expect(cleanTitle('Breaking Bad')).toBe('Breaking Bad');
  });
});
