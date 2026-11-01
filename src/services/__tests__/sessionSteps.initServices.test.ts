/**
 * Démarrage des services : la langue du cache TMDB est vérifiée au
 * démarrage, avec la langue enregistrée déjà appliquée. Sinon un appareil réglé en anglais sur un
 * système français garderait des fiches françaises, ou viderait son cache à chaque lancement.
 *
 * i18next et le calcul de la langue TMDB sont les vrais ; seuls les services voisins sont simulés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Démarrage en français : les textes anglais ne sont pas encore chargés quand la langue enregistrée
// « en » est appliquée (textes chargés à la demande). Avant les imports.
vi.hoisted(() => localStorage.setItem('nyx_language', 'fr'));

let savedLanguage: string | null = null;
const order: string[] = [];
/** Langue TMDB demandée, et langue affichée par i18next au moment de l'appel */
const cacheLanguageCalls: { requested: string; appLanguage: string | undefined }[] = [];

vi.mock('../preferencesService', () => ({
  initPreferences: vi.fn(async () => { order.push('initPreferences'); }),
  getLanguage: vi.fn(() => savedLanguage),
  computeProviderHash: vi.fn(async () => 'hash'),
}));
vi.mock('../tmdbCacheSqlite', () => ({
  ensureCacheLanguage: vi.fn(async (language: string) => {
    order.push('ensureCacheLanguage');
    cacheLanguageCalls.push({ requested: language, appLanguage: i18n.resolvedLanguage });
  }),
}));
vi.mock('../liveTvBookmarksService', () => ({
  initLiveTvBookmarks: vi.fn(async () => { order.push('initLiveTvBookmarks'); }),
  resetLiveTvBookmarksCache: vi.fn(),
}));
vi.mock('../hiddenCategoriesService', () => ({
  initHiddenCategories: vi.fn(async () => { order.push('initHiddenCategories'); }),
  resetHiddenCategories: vi.fn(),
}));
vi.mock('../piconCache', () => ({ initPiconCache: vi.fn(async () => { order.push('initPiconCache'); }) }));

import i18n from '../../i18n/config';
import { initServices, applySyncedLanguage } from '../sessionSteps';
import { dashboardCache, isDashboardReloading, markDashboardLoaded } from '../dashboardCache';
import { TMDB_LANGUAGE_EVENT } from '../eventConstants';

describe('initServices — langue du cache TMDB au démarrage', () => {
  beforeEach(async () => {
    savedLanguage = null;
    order.length = 0;
    cacheLanguageCalls.length = 0;
    await i18n.changeLanguage('fr-FR');
  });

  it('langue enregistrée « en » sur un système français : cache vérifié en en-US, après l\'avoir appliquée', async () => {
    savedLanguage = 'en';

    await initServices();

    expect(cacheLanguageCalls).toEqual([{ requested: 'en-US', appLanguage: 'en' }]);
  });

  it('aucune langue enregistrée sur un système français : cache vérifié en fr-FR', async () => {
    await initServices();

    expect(cacheLanguageCalls).toEqual([{ requested: 'fr-FR', appLanguage: 'fr' }]);
  });

  it('vérifié après la lecture des préférences et avant les autres services (premier affichage)', async () => {
    await initServices();

    expect(order).toEqual(['initPreferences', 'ensureCacheLanguage', 'initLiveTvBookmarks', 'initHiddenCategories', 'initPiconCache']);
  });
});

describe('applySyncedLanguage — langue reçue du cloud pendant la session', () => {
  beforeEach(async () => {
    savedLanguage = null;
    order.length = 0;
    cacheLanguageCalls.length = 0;
    await i18n.changeLanguage('fr-FR');
    markDashboardLoaded();
    dashboardCache.hasData = true;
  });

  it('autre langue reçue : cache TMDB vérifié dans la nouvelle langue, accueil et fiches prévenus', async () => {
    savedLanguage = 'en';
    const heard = vi.fn();
    window.addEventListener(TMDB_LANGUAGE_EVENT, heard);

    expect(await applySyncedLanguage()).toBe(true);

    window.removeEventListener(TMDB_LANGUAGE_EVENT, heard);
    expect(i18n.resolvedLanguage).toBe('en');
    expect(cacheLanguageCalls).toEqual([{ requested: 'en-US', appLanguage: 'en' }]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(dashboardCache.hasData).toBe(false);
    expect(isDashboardReloading()).toBe(true);
  });

  it('même langue : rien n\'est vidé ni rechargé', async () => {
    savedLanguage = 'fr';
    const heard = vi.fn();
    window.addEventListener(TMDB_LANGUAGE_EVENT, heard);

    expect(await applySyncedLanguage()).toBe(false);

    window.removeEventListener(TMDB_LANGUAGE_EVENT, heard);
    expect(cacheLanguageCalls).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    expect(dashboardCache.hasData).toBe(true);
  });
});
