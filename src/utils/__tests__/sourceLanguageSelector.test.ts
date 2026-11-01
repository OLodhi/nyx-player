import { describe, it, expect } from 'vitest';
import { selectBestSourceIndex } from '../sourceLanguageSelector';

describe('sourceLanguageSelector', () => {
  describe('selectBestSourceIndex', () => {
    // --- FR ---
    it('app FR + source "[FR]" → sélectionne FR', () => {
      const names = ['Movie XYZ [EN]', 'Movie XYZ [FR]', 'Movie XYZ MULTI'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('app FR + source "VF" → sélectionne VF', () => {
      const names = ['Movie XYZ VO', 'Movie XYZ VF'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('app FR + source "FRENCH" → sélectionne FRENCH', () => {
      const names = ['Movie ENGLISH', 'Movie FRENCH'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('app FR + pas de FR mais MULTI → sélectionne MULTI', () => {
      const names = ['Movie XYZ [EN]', 'Movie XYZ MULTI'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('app FR + ni FR ni MULTI → fallback index 0', () => {
      const names = ['Movie XYZ [EN]', 'Movie XYZ VO'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(0);
    });

    // --- EN ---
    it('app EN + source "EN" → sélectionne EN', () => {
      const names = ['Movie XYZ [FR]', 'Movie XYZ [EN]'];
      expect(selectBestSourceIndex(names, 'en')).toBe(1);
    });

    it('app EN + source "VO" → sélectionne VO', () => {
      const names = ['Movie XYZ VF', 'Movie XYZ VO'];
      expect(selectBestSourceIndex(names, 'en')).toBe(1);
    });

    it('app EN + source "ENG" → sélectionne ENG', () => {
      const names = ['Movie XYZ VF', 'Movie XYZ ENG'];
      expect(selectBestSourceIndex(names, 'en')).toBe(1);
    });

    it('app EN + source "ENGLISH" → sélectionne ENGLISH', () => {
      const names = ['Movie FRENCH', 'Movie ENGLISH'];
      expect(selectBestSourceIndex(names, 'en')).toBe(1);
    });

    it('app EN + pas de EN mais MULTI → sélectionne MULTI', () => {
      const names = ['Movie XYZ [FR]', 'Movie XYZ MULTI'];
      expect(selectBestSourceIndex(names, 'en')).toBe(1);
    });

    // --- Edge cases ---
    it('aucun match → fallback index 0', () => {
      const names = ['Movie Alpha', 'Movie Beta'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(0);
    });

    it('source unique → retourne 0', () => {
      const names = ['Movie XYZ'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(0);
    });

    it('liste vide → retourne 0', () => {
      expect(selectBestSourceIndex([], 'fr')).toBe(0);
    });

    it('case insensitive — "vf" et "VF" matchent', () => {
      const names = ['Movie XYZ en', 'Movie XYZ vf'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('token partiel non-match — "FRIEND" ne matche pas FR', () => {
      const names = ['My FRIEND Movie', 'Movie XYZ [FR]'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('token partiel non-match — "FRENCH" ne matche pas "FRENCHIE"', () => {
      const names = ['FRENCHIE Movie', 'Movie FRENCH'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('priorité langue > MULTI (FR avant MULTI)', () => {
      const names = ['Movie MULTI', 'Movie FR'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(1);
    });

    it('langue non supportée → fallback index 0', () => {
      const names = ['Movie FR', 'Movie EN'];
      expect(selectBestSourceIndex(names, 'de')).toBe(0);
    });

    it('premier match langue trouvé est retourné', () => {
      const names = ['Movie FR 720p', 'Movie FR 1080p', 'Movie EN'];
      expect(selectBestSourceIndex(names, 'fr')).toBe(0);
    });
  });
});
