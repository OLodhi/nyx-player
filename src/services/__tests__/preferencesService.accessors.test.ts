/**
 * preferencesService : accesseurs de chaque réglage (valeur par défaut, valeur enregistrée, écriture
 * SQLite, événement, envoi au cloud) et cas d'erreur de l'initialisation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
};
vi.mock('../dbCore', () => ({ getDatabase: vi.fn(() => Promise.resolve(mockDb)) }));
vi.mock('../syncService', () => ({ pushPreferenceToCloud: vi.fn() }));
vi.mock('../carouselConstants', () => ({
  DEFAULT_CAROUSELS: [
    { id: 'popular', label_fr: 'Populaires', label_en: 'Popular', removable: true },
    { id: 'fixed', label_fr: 'Fixe', label_en: 'Fixed', removable: false },
  ],
}));

import {
  initPreferences, resetPreferencesCache,
  getHomePage, setHomePage,
  isBingeModeEnabled, setBingeMode, getBingeCountdown, setBingeCountdown,
  isGeekStatsEnabled, setGeekStats,
  getDnsProvider, setDnsProvider,
  getLanguage, setLanguage,
  getCarouselPreferences, isCarouselEnabled, isGenreEnabled, toggleCarousel, toggleGenre,
  getEnabledGenres, isExoticFilterEnabled, setExoticFilter,
  getDashboardDefaultMode, setDashboardDefaultMode,
  getSubtitleScale, setSubtitleScale,
  getLastProviderHash, setLastProviderHash, computeProviderHash,
  isEpgEnabled, setEpgEnabled, isEpgWifiOnly, setEpgWifiOnly,
} from '../preferencesService';
import { getDatabase } from '../dbCore';
import { pushPreferenceToCloud } from '../syncService';
import { PREFERENCES_EVENT, CAROUSEL_PREFERENCES_EVENT } from '../eventConstants';

let prefEvents: Array<{ key: string; value: string | null }>;
let carouselEvents: number;
const onPref = (e: Event) => { prefEvents.push((e as CustomEvent).detail); };
const onCarousel = () => { carouselEvents++; };

beforeEach(async () => {
  vi.clearAllMocks();
  mockDb.select.mockResolvedValue([]);
  mockDb.execute.mockResolvedValue(undefined);
  resetPreferencesCache();
  prefEvents = [];
  carouselEvents = 0;
  window.removeEventListener(PREFERENCES_EVENT, onPref);
  window.removeEventListener(CAROUSEL_PREFERENCES_EVENT, onCarousel);
  window.addEventListener(PREFERENCES_EVENT, onPref);
  window.addEventListener(CAROUSEL_PREFERENCES_EVENT, onCarousel);
});

/** Dernier INSERT dans user_preferences : [clé, valeur] */
function lastWrite(): [unknown, unknown] {
  const calls = mockDb.execute.mock.calls;
  const params = calls[calls.length - 1][1] as unknown[];
  return [params[0], params[1]];
}

describe('valeurs par défaut (cache vide)', () => {
  it('renvoie les réglages d\'usine', () => {
    expect(getHomePage()).toBe('dashboard');
    expect(isBingeModeEnabled()).toBe(false);
    expect(getBingeCountdown()).toBe(15);
    expect(isGeekStatsEnabled()).toBe(true);
    expect(getDnsProvider()).toBe('cloudflare');
    expect(getLanguage()).toBe('en');
    expect(getDashboardDefaultMode()).toBe('suggestions');
    expect(getSubtitleScale()).toBe(1);
    expect(isEpgEnabled()).toBe(false);
    expect(isEpgWifiOnly()).toBe(true);
    expect(getLastProviderHash()).toBeNull();
  });

  it('renvoie les carrousels d\'usine : Action et Comédie, filtre exotique actif', () => {
    expect(getCarouselPreferences()).toEqual({
      disabledCarousels: [], enabledGenres: [28, 35], filterExoticScripts: true,
    });
    expect(getEnabledGenres()).toEqual([28, 35]);
    expect(isExoticFilterEnabled()).toBe(true);
    expect(isGenreEnabled(28)).toBe(true);
    expect(isGenreEnabled(99)).toBe(false);
    expect(isCarouselEnabled('popular')).toBe(true);
  });
});

describe('écriture d\'un réglage', () => {
  it('enregistre en SQLite, met à jour le cache, prévient l\'interface et envoie au cloud', async () => {
    await setHomePage('live' as never);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO user_preferences');
    expect(sql).toContain('ON CONFLICT(key) DO UPDATE');
    expect(params?.slice(0, 2)).toEqual(['home_page', 'live']);
    expect(typeof params?.[2]).toBe('number');
    expect(getHomePage()).toBe('live');
    expect(prefEvents).toEqual([{ key: 'home_page', value: 'live' }]);
    expect(pushPreferenceToCloud).toHaveBeenCalledWith('home_page', 'live', params?.[2]);
  });

  it('en cas d\'échec SQLite : cache inchangé, aucun événement, rien envoyé au cloud', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('disque plein'));
    await expect(setHomePage('live' as never)).resolves.toBeUndefined();
    expect(getHomePage()).toBe('dashboard');
    expect(prefEvents).toEqual([]);
    expect(pushPreferenceToCloud).not.toHaveBeenCalled();
  });

  it('en cas d\'échec d\'ouverture de la base : même comportement', async () => {
    vi.mocked(getDatabase).mockRejectedValueOnce(new Error('fermée'));
    await setLanguage('fr');
    expect(getLanguage()).toBe('en');
    expect(pushPreferenceToCloud).not.toHaveBeenCalled();
  });

  it.each([
    ['binge', () => setBingeMode(true), 'binge_mode', 'true'],
    ['compte à rebours', () => setBingeCountdown(30), 'binge_countdown', '30'],
    ['statistiques', () => setGeekStats(false), 'geek_stats_enabled', 'false'],
    ['DNS', () => setDnsProvider('google' as never), 'dns_provider', 'google'],
    ['langue', () => setLanguage('fr'), 'language', 'fr'],
    ['mode du tableau de bord', () => setDashboardDefaultMode('films'), 'dashboard_default_mode', 'films'],
    ['taille des sous-titres', () => setSubtitleScale(1.5), 'subtitle_scale', '1.5'],
    ['guide TV', () => setEpgEnabled(true), 'epg_enabled', 'true'],
    ['guide Wi-Fi', () => setEpgWifiOnly(false), 'epg_wifi_only', 'false'],
  ])('%s : clé et valeur écrites en texte', async (_nom, action, key, value) => {
    await action();
    expect(lastWrite()).toEqual([key, value]);
  });
});

describe('lecture après écriture', () => {
  it('relit les valeurs enregistrées', async () => {
    await setBingeMode(true);
    await setBingeCountdown(30);
    await setGeekStats(false);
    await setDnsProvider('google' as never);
    await setDashboardDefaultMode('series');
    await setSubtitleScale(1.5);
    await setEpgEnabled(true);
    await setEpgWifiOnly(false);
    expect(isBingeModeEnabled()).toBe(true);
    expect(getBingeCountdown()).toBe(30);
    expect(isGeekStatsEnabled()).toBe(false);
    expect(getDnsProvider()).toBe('google');
    expect(getDashboardDefaultMode()).toBe('series');
    expect(getSubtitleScale()).toBe(1.5);
    expect(isEpgEnabled()).toBe(true);
    expect(isEpgWifiOnly()).toBe(false);
  });

  it('un compte à rebours ou une échelle à 0 retombent sur la valeur par défaut', async () => {
    await setBingeCountdown(0);
    await setSubtitleScale(0);
    expect(getBingeCountdown()).toBe(15);
    expect(getSubtitleScale()).toBe(1);
  });
});

describe('carrousels', () => {
  it('ignore un carrousel non retirable, sans écriture ni événement', async () => {
    await toggleCarousel('fixed');
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(carouselEvents).toBe(0);
  });

  it('ignore un carrousel inconnu', async () => {
    await toggleCarousel('inexistant');
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('désactive puis réactive un carrousel et prévient l\'interface', async () => {
    await toggleCarousel('popular');
    expect(isCarouselEnabled('popular')).toBe(false);
    expect(carouselEvents).toBe(1);
    await toggleCarousel('popular');
    expect(isCarouselEnabled('popular')).toBe(true);
    expect(carouselEvents).toBe(2);
  });

  it('écrit les trois clés de carrousel à chaque changement', async () => {
    await toggleGenre(18);
    expect(mockDb.execute.mock.calls.map((c) => (c[1] as unknown[])[0])).toEqual([
      'disabled_carousels', 'enabled_genres', 'filter_exotic_scripts',
    ]);
    expect(getEnabledGenres()).toEqual([28, 35, 18]);
  });

  it('retire un genre déjà actif', async () => {
    await toggleGenre(28);
    expect(getEnabledGenres()).toEqual([35]);
    expect(isGenreEnabled(28)).toBe(false);
  });

  it('active et désactive le filtre des écritures exotiques', async () => {
    await setExoticFilter(false);
    expect(isExoticFilterEnabled()).toBe(false);
    await setExoticFilter(true);
    expect(isExoticFilterEnabled()).toBe(true);
  });

  it('un JSON de genres corrompu retombe sur Action et Comédie', async () => {
    mockDb.select.mockResolvedValueOnce([{ key: 'enabled_genres', value: '[28,' }]);
    await initPreferences();
    expect(getEnabledGenres()).toEqual([28, 35]);
  });
});

describe('empreinte du fournisseur', () => {
  it('setLastProviderHash enregistre le SHA-256 de l\'adresse et le renvoie aussitôt', async () => {
    await setLastProviderHash('fournisseur.exemple.test');
    const expected = await computeProviderHash('fournisseur.exemple.test');
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(lastWrite()).toEqual(['last_provider_hash', expected]);
    expect(getLastProviderHash()).toBe(expected);
  });

  it('deux adresses différentes donnent deux empreintes différentes, une même adresse la même', async () => {
    const a1 = await computeProviderHash('a.exemple.test');
    const a2 = await computeProviderHash('a.exemple.test');
    const b = await computeProviderHash('b.exemple.test');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it('l\'initialisation lit meta.lastProvider et en tire l\'empreinte de l\'appareil', async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes("key = 'lastProvider'")) return [{ value: 'fournisseur.exemple.test' }];
      if (sql.includes('user_preferences')) return [{ key: 'language', value: 'fr' }];
      return [];
    });
    await initPreferences();
    expect(getLastProviderHash()).toBe(await computeProviderHash('fournisseur.exemple.test'));
  });
});

describe('initPreferences - erreurs', () => {
  it('continue avec un cache vide si la lecture des préférences échoue, et sème la langue', async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM user_preferences')) throw new Error('KO');
      return [];
    });
    await initPreferences();
    expect(lastWrite()[0]).toBe('language');
    expect(getHomePage()).toBe('dashboard');
  });

  it('empreinte de l\'appareil à null si meta est illisible', async () => {
    mockDb.select.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM meta')) throw new Error('KO');
      return [{ key: 'language', value: 'fr' }];
    });
    await initPreferences();
    expect(getLastProviderHash()).toBeNull();
    expect(getLanguage()).toBe('fr');
  });

  it('ne sème pas la langue quand une valeur existe déjà (le cloud gagne)', async () => {
    mockDb.select.mockImplementation(async (sql: string) =>
      sql.includes('FROM user_preferences') ? [{ key: 'language', value: 'fr' }] : []);
    await initPreferences();
    expect(mockDb.execute).not.toHaveBeenCalled();
    expect(getLanguage()).toBe('fr');
  });
});
