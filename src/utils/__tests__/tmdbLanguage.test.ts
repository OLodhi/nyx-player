/**
 * Non-régression : la langue TMDB doit suivre la langue réellement
 * affichée par l'app, même quand le système annonce une locale régionale
 * (en-US, en-GB, fr-CA…) ou une langue non traduite (de-DE…).
 */
import { afterAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n/config';
import { getAppLanguage, getTmdbLanguage, isEnglish } from '../tmdbLanguage';

const initial = i18n.language;

async function setLng(lng: string) {
  await i18n.changeLanguage(lng);
}

describe('tmdbLanguage', () => {
  afterAll(async () => {
    await i18n.changeLanguage(initial);
  });

  it.each([
    ['en', 'en', 'en-US'],
    ['en-US', 'en', 'en-US'],
    ['en-GB', 'en', 'en-US'],
    ['en-IN', 'en', 'en-US'],
    ['fr', 'fr', 'fr-FR'],
    ['fr-FR', 'fr', 'fr-FR'],
    ['fr-CA', 'fr', 'fr-FR'],
    ['fr-BE', 'fr', 'fr-FR'],
    // Langue sans traduction : l'interface retombe sur l'anglais, TMDB aussi.
    ['de-DE', 'en', 'en-US'],
    ['hi-IN', 'en', 'en-US'],
  ])('locale %s → app %s, TMDB %s', async (lng, app, tmdb) => {
    await setLng(lng);
    expect(getAppLanguage()).toBe(app);
    expect(getTmdbLanguage()).toBe(tmdb);
    expect(isEnglish()).toBe(app === 'en');
  });
});
