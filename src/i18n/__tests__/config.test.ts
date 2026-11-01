/**
 * L'écran « Qui regarde ? » s'affiche avant l'ouverture de la base du compte, où la
 * langue choisie est rangée. La dernière langue affichée est donc rappelée sur l'appareil et reprise
 * au démarrage, avant la langue du système.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function freshI18n() {
  vi.resetModules();
  const mod = await import('../config');
  await mod.i18nReady;
  return { i18n: mod.default, key: mod.LANGUAGE_STORAGE_KEY };
}

describe('i18n config : langue au démarrage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('reprend la dernière langue choisie plutôt que celle du système', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'fr-FR', languages: ['fr-FR'] });
    localStorage.setItem('nyx_language', 'en');
    const { i18n } = await freshI18n();
    expect(i18n.resolvedLanguage).toBe('en');
  });

  it('suit la langue du système au premier lancement', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'fr-FR', languages: ['fr-FR'] });
    const { i18n } = await freshI18n();
    expect(i18n.resolvedLanguage).toBe('fr');
  });

  it('rappelle la langue changée pour le prochain démarrage', async () => {
    const { i18n, key } = await freshI18n();
    await i18n.changeLanguage('en');
    expect(localStorage.getItem(key)).toBe('en');
    await i18n.changeLanguage('fr');
    expect(localStorage.getItem(key)).toBe('fr');
  });
});

/**
 * Seuls les textes de la langue affichée sont chargés au démarrage ; l'autre langue arrive à
 * son premier choix, avant que l'interface ne bascule.
 */
describe('i18n config : textes chargés langue par langue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('ne charge que le français pour un appareil en français', async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'fr-FR', languages: ['fr-FR'] });
    const { i18n } = await freshI18n();
    expect(i18n.hasResourceBundle('fr', 'settings')).toBe(true);
    expect(i18n.hasResourceBundle('en', 'common')).toBe(false);
    expect(i18n.t('common:cancel')).toBe('Annuler');
  });

  it('a tous les textes prêts dès le démarrage, dans tous les espaces', async () => {
    localStorage.setItem('nyx_language', 'en');
    const { i18n } = await freshI18n();
    for (const ns of ['common', 'dashboard', 'settings', 'player', 'auth', 'navigation', 'details', 'search', 'tv']) {
      expect(i18n.hasResourceBundle('en', ns), ns).toBe(true);
    }
    expect(i18n.hasResourceBundle('fr', 'common')).toBe(false);
  });

  it("charge l'autre langue à son premier choix, puis l'affiche", async () => {
    localStorage.setItem('nyx_language', 'fr');
    const { i18n } = await freshI18n();
    expect(i18n.t('common:cancel')).toBe('Annuler');
    await i18n.changeLanguage('en');
    expect(i18n.resolvedLanguage).toBe('en');
    expect(i18n.t('common:cancel')).toBe('Cancel');
  });

  it("passe à l'anglais pour une langue sans textes (allemand)", async () => {
    vi.stubGlobal('navigator', { ...navigator, language: 'de-DE', languages: ['de-DE'] });
    const { i18n } = await freshI18n();
    expect(i18n.resolvedLanguage).toBe('en');
    expect(i18n.hasResourceBundle('fr', 'common')).toBe(false);
  });
});

describe('i18n config : bloc de langue illisible', () => {
  afterEach(() => {
    vi.doUnmock('../locales/en');
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("le signale au journal sans bloquer le démarrage", async () => {
    localStorage.setItem('nyx_language', 'en');
    vi.doMock('../locales/en', () => { throw new Error('bloc absent'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await freshI18n();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[i18n] Textes « en » illisibles'), expect.anything());
  });
});
