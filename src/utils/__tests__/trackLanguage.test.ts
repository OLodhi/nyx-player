import { describe, it, expect } from 'vitest';
import { matchesLanguage, pickTrackForLanguage } from '../trackLanguage';

describe('trackLanguage', () => {
  it('reconnaît les codes ISO français et anglais', () => {
    expect(matchesLanguage({ lang: 'fr' }, 'fr')).toBe(true);
    expect(matchesLanguage({ lang: 'fre' }, 'fr')).toBe(true);
    expect(matchesLanguage({ lang: 'fra' }, 'fr')).toBe(true);
    expect(matchesLanguage({ lang: 'eng' }, 'en')).toBe(true);
    expect(matchesLanguage({ lang: 'ar' }, 'fr')).toBe(false);
    expect(matchesLanguage({ lang: 'fr' }, 'en')).toBe(false);
  });

  it('reconnaît les libellés des fournisseurs IPTV', () => {
    expect(matchesLanguage({ title: 'Français (VFF)' }, 'fr')).toBe(true);
    expect(matchesLanguage({ title: 'VF' }, 'fr')).toBe(true);
    expect(matchesLanguage({ title: 'French DD+ 5.1' }, 'fr')).toBe(true);
    expect(matchesLanguage({ title: 'English' }, 'en')).toBe(true);
    expect(matchesLanguage({ title: 'Japanese' }, 'fr')).toBe(false);
  });

  it('ignore une langue inconnue et les pistes sans info', () => {
    expect(matchesLanguage({ lang: 'fr' }, 'de')).toBe(false);
    expect(matchesLanguage({}, 'fr')).toBe(false);
  });

  it('choisit la première piste dans la langue de l\'app', () => {
    const tracks = [
      { id: 1, lang: 'ar', title: 'Arabic' },
      { id: 2, lang: 'cs', title: 'Czech' },
      { id: 3, lang: 'fr', title: 'French (Canada)' },
      { id: 4, lang: 'fr', title: 'French' },
    ];
    expect(pickTrackForLanguage(tracks, 'fr')?.id).toBe(3);
    expect(pickTrackForLanguage(tracks, 'en')).toBeUndefined();
  });
});
