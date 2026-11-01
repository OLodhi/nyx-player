/**
 * Tests pour preferencesService.ts
 *
 * 15 tests couvrant le système de préférences SQLite-first avec cache mémoire :
 * - initPreferences (charge cache, idempotence, seed langue)
 * - getters/setters (homePage, bingeMode, carouselPreferences)
 * - toggleCarousel / toggleGenre
 * - resetPreferencesCache / refreshPreferencesCache
 * - setPreference → pushPreferenceToCloud
 * - safeJsonParse (null, corrupted)
 * - computeProviderHash (SHA-256)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import i18next from 'i18next';

// ============================================================================
// Mock SQLite
// ============================================================================

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValue([]),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
};

vi.mock('../nyxDatabase', () => ({
  default: {
    load: vi.fn(() => Promise.resolve(mockDb)),
  },
}));

// Phase 2 Multi-User : débloquer la garde dbName dans getDatabase()
import { setDatabaseName } from '../dbCore';
setDatabaseName('test-uid');

// ============================================================================
// Mock syncService (fire-and-forget)
// ============================================================================

vi.mock('../syncService', () => ({
  pushPreferenceToCloud: vi.fn(),
}));

import { pushPreferenceToCloud } from '../syncService';
import { recordServerTime, resetServerClock } from '../sync/serverClock';

// ============================================================================
// Mock carouselConstants (import dynamique dans toggleCarousel)
// ============================================================================

vi.mock('../carouselConstants', () => ({
  DEFAULT_CAROUSELS: [
    { id: 'popular', label_fr: 'Films Populaires', label_en: 'Popular Movies', removable: true },
    { id: 'continue', label_fr: 'Reprendre', label_en: 'Continue Watching', removable: true },
    { id: 'fixed', label_fr: 'Non-removable', label_en: 'Not removable', removable: false },
  ],
}));

// ============================================================================
// Mock window.dispatchEvent
// ============================================================================

const dispatchSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => true);

// Constante pour le test SHA-256
const KNOWN_HOST = 'example.com';

// ============================================================================
// Import du module sous test
// ============================================================================

import {
  initPreferences,
  resetPreferencesCache,
  refreshPreferencesCache,
  getHomePage,
  setHomePage,
  isBingeModeEnabled,
  setBingeMode,
  getCarouselPreferences,
  toggleCarousel,
  toggleGenre,
  setLanguage,
  computeProviderHash,
  getLastProviderHash,
  setLastProviderHash,
} from '../preferencesService';

// ============================================================================
// TESTS
// ============================================================================

describe('preferencesService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockResolvedValue([]);
    mockDb.execute.mockResolvedValue(undefined);


    // Reset état interne du module (cache + initialized)
    resetPreferencesCache();
    dispatchSpy.mockClear();

    // Reset navigator.language au défaut
    Object.defineProperty(navigator, 'language', {
      value: 'fr-FR',
      writable: true,
      configurable: true,
    });
  });

  // ──────────────────────────────────────────────
  // 1. initPreferences charge le cache
  // ──────────────────────────────────────────────
  it('initPreferences — SELECT charge le cache mémoire', async () => {
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'live' },
      { key: 'binge_mode', value: 'true' },
    ]);
    // Mock seed langue : la clé 'language' n'est pas dans les résultats
    // → seed va s'exécuter. On doit anticiper que getPreference('language') retournera null
    // car le cache est vide au départ et les résultats ci-dessus n'incluent pas 'language'.

    await initPreferences();

    // Vérifier que SELECT a été appelé
    const selectCall = mockDb.select.mock.calls.find(
      (c) => (c[0] as string).includes('SELECT key, value FROM user_preferences')
    );
    expect(selectCall).toBeDefined();

    // Cache rempli → les getters synchrones retournent les bonnes valeurs
    expect(getHomePage()).toBe('live');
    expect(isBingeModeEnabled()).toBe(true);
  });

  // ──────────────────────────────────────────────
  // 2. initPreferences idempotent
  // ──────────────────────────────────────────────
  it('initPreferences — deuxième appel ne re-SELECT pas', async () => {
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'live' },
    ]);

    await initPreferences();
    const firstCallCount = mockDb.select.mock.calls.length;

    await initPreferences(); // 2ème appel
    const secondCallCount = mockDb.select.mock.calls.length;

    // Pas d'appel supplémentaire
    expect(secondCallCount).toBe(firstCallCount);
  });

  // ──────────────────────────────────────────────
  // 3. getHomePage default
  // ──────────────────────────────────────────────
  it('getHomePage — cache vide retourne "dashboard" par défaut', () => {
    // resetPreferencesCache() déjà appelé dans beforeEach → cache vide
    expect(getHomePage()).toBe('dashboard');
  });

  // ──────────────────────────────────────────────
  // 4. setHomePage + getHomePage
  // ──────────────────────────────────────────────
  it('setHomePage + getHomePage — set "live" puis get retourne "live"', async () => {
    await setHomePage('live');

    expect(getHomePage()).toBe('live');

    // Vérifie l'écriture SQLite
    const insertCall = mockDb.execute.mock.calls.find(
      (c) => (c[0] as string).includes('INSERT INTO user_preferences')
    );
    expect(insertCall).toBeDefined();
    const params = insertCall![1] as unknown[];
    expect(params[0]).toBe('home_page');
    expect(params[1]).toBe('live');
  });

  // ──────────────────────────────────────────────
  // 5. isBingeModeEnabled true/false
  // ──────────────────────────────────────────────
  it('isBingeModeEnabled — "true" → true, absent → false', async () => {
    // Absent → false
    expect(isBingeModeEnabled()).toBe(false);

    // Set to true
    await setBingeMode(true);
    expect(isBingeModeEnabled()).toBe(true);

    // Set to false
    await setBingeMode(false);
    expect(isBingeModeEnabled()).toBe(false);
  });

  // ──────────────────────────────────────────────
  // 6. getCarouselPreferences JSON parse (valide + invalide)
  // ──────────────────────────────────────────────
  it('getCarouselPreferences — JSON valide parsed, invalide → default', async () => {
    // Simuler un cache avec JSON valide pour disabled_carousels
    // et JSON invalide pour enabled_genres
    // On utilise initPreferences avec des données pré-remplies
    mockDb.select.mockResolvedValueOnce([
      { key: 'disabled_carousels', value: '["popular"]' },
      { key: 'enabled_genres', value: '{INVALID JSON' },
      { key: 'filter_exotic_scripts', value: 'false' },
      { key: 'language', value: 'fr' }, // Évite le seed
    ]);

    await initPreferences();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const prefs = getCarouselPreferences();

    // JSON valide → parsed
    expect(prefs.disabledCarousels).toEqual(['popular']);
    // JSON invalide → default ([28, 35])
    expect(prefs.enabledGenres).toEqual([28, 35]);
    // Boolean string
    expect(prefs.filterExoticScripts).toBe(false);

    // Console.error appelé pour le JSON corrompu
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Corrupted JSON'),
      expect.anything()
    );

    consoleErrorSpy.mockRestore();
  });

  // ──────────────────────────────────────────────
  // 7. toggleCarousel add/remove
  // ──────────────────────────────────────────────
  it('toggleCarousel — add puis remove du disabledCarousels', async () => {
    // Init avec cache vide (aucun carousel désactivé)
    mockDb.select.mockResolvedValueOnce([
      { key: 'language', value: 'fr' },
    ]);
    await initPreferences();

    // Toggle 'popular' → désactive (ajout dans disabledCarousels)
    await toggleCarousel('popular');

    let prefs = getCarouselPreferences();
    expect(prefs.disabledCarousels).toContain('popular');

    // Toggle 'popular' à nouveau → réactive (retrait de disabledCarousels)
    await toggleCarousel('popular');

    prefs = getCarouselPreferences();
    expect(prefs.disabledCarousels).not.toContain('popular');

    // Toggle 'fixed' (non-removable) → no-op
    await toggleCarousel('fixed');
    prefs = getCarouselPreferences();
    expect(prefs.disabledCarousels).not.toContain('fixed');
  });

  // ──────────────────────────────────────────────
  // 8. toggleGenre add/remove
  // ──────────────────────────────────────────────
  it('toggleGenre — add puis remove de enabledGenres', async () => {
    // Init avec les genres par défaut [28, 35]
    mockDb.select.mockResolvedValueOnce([
      { key: 'language', value: 'fr' },
    ]);
    await initPreferences();

    // Default: enabledGenres = [28, 35]
    let prefs = getCarouselPreferences();
    expect(prefs.enabledGenres).toEqual([28, 35]);

    // Toggle 80 (Crime) → ajout
    await toggleGenre(80);
    prefs = getCarouselPreferences();
    expect(prefs.enabledGenres).toContain(80);

    // Toggle 28 (Action) → retrait
    await toggleGenre(28);
    prefs = getCarouselPreferences();
    expect(prefs.enabledGenres).not.toContain(28);
  });

  // ──────────────────────────────────────────────
  // 9. resetPreferencesCache
  // ──────────────────────────────────────────────
  it('resetPreferencesCache — cache vidé, initialized = false, event dispatché', async () => {
    // D'abord, remplir le cache
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'watchlist' },
      { key: 'language', value: 'fr' },
    ]);
    await initPreferences();
    expect(getHomePage()).toBe('watchlist');

    dispatchSpy.mockClear();

    // Reset
    resetPreferencesCache();

    // Cache vidé → getter retourne default
    expect(getHomePage()).toBe('dashboard');

    // Event dispatché avec key='*'
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'preferencesUpdated',
        detail: { key: '*', value: null },
      })
    );

    // initialized = false → on peut re-init
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'live' },
      { key: 'language', value: 'en' },
    ]);
    await initPreferences();
    expect(getHomePage()).toBe('live');
  });

  // ──────────────────────────────────────────────
  // 10. refreshPreferencesCache
  // ──────────────────────────────────────────────
  it('refreshPreferencesCache — recharge depuis SQLite, ancien cache écrasé', async () => {
    // Init avec valeur initiale
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'live' },
      { key: 'language', value: 'fr' },
    ]);
    await initPreferences();
    expect(getHomePage()).toBe('live');

    // Refresh avec nouvelle valeur
    mockDb.select.mockResolvedValueOnce([
      { key: 'home_page', value: 'watchlist' },
      { key: 'binge_mode', value: 'true' },
    ]);
    await refreshPreferencesCache();

    // Nouveau cache reflété
    expect(getHomePage()).toBe('watchlist');
    expect(isBingeModeEnabled()).toBe(true);
  });

  // ──────────────────────────────────────────────
  // 11. setPreference push cloud
  // ──────────────────────────────────────────────
  it('setPreference — appelle pushPreferenceToCloud', async () => {
    await setLanguage('en');

    expect(pushPreferenceToCloud).toHaveBeenCalledWith('language', 'en', expect.any(Number));
  });

  it('setPreference — box en avance de 2 jours : datée à l’heure du serveur, en local comme dans le cloud', async () => {
    const serverTime = Date.UTC(2026, 9, 12, 10, 0, 0);
    vi.useFakeTimers({ toFake: ['Date'], now: serverTime + 2 * 24 * 60 * 60 * 1000 });
    try {
      recordServerTime(serverTime);
      await setLanguage('en');
    } finally {
      vi.useRealTimers();
      resetServerClock();
    }

    const write = mockDb.execute.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_preferences'));
    expect(write?.[1]).toEqual(['language', 'en', serverTime]);
    expect(pushPreferenceToCloud).toHaveBeenCalledWith('language', 'en', serverTime);
  });

  // ──────────────────────────────────────────────
  // 12. Seed langue OS
  // ──────────────────────────────────────────────
  it('initPreferences — seed langue OS si absent (navigator.language)', async () => {
    Object.defineProperty(navigator, 'language', {
      value: 'fr-FR',
      writable: true,
      configurable: true,
    });

    // Cache vide, pas de clé 'language' → seed OS
    mockDb.select.mockResolvedValueOnce([]); // Aucune pref en DB

    await initPreferences();

    // La seed doit insérer 'fr' (navigator.language.slice(0,2))
    const seedCall = mockDb.execute.mock.calls.find(
      (c) => {
        const params = c[1] as unknown[] | undefined;
        return params && params[0] === 'language';
      }
    );
    expect(seedCall).toBeDefined();
    const params = seedCall![1] as unknown[];
    expect(params[1]).toBe('fr'); // Langue seedée
    expect(params[2]).toBe(0);   // updated_at = 0 (epoch)
  });

  it('initPreferences — seed fallback "en" si langue OS non supportée', async () => {
    Object.defineProperty(navigator, 'language', {
      value: 'de-DE',
      writable: true,
      configurable: true,
    });

    mockDb.select.mockResolvedValueOnce([]);

    await initPreferences();

    const seedCall = mockDb.execute.mock.calls.find(
      (c) => {
        const params = c[1] as unknown[] | undefined;
        return params && params[0] === 'language';
      }
    );
    expect(seedCall).toBeDefined();
    const params = seedCall![1] as unknown[];
    expect(params[1]).toBe('en'); // Fallback EN pour langue non supportée
  });

  it('initPreferences — seed = langue affichée, pas celle du système', async () => {
    // Système en français, mais « English » choisi sur l'écran de connexion avant de créer le compte
    Object.defineProperty(navigator, 'language', {
      value: 'fr-FR',
      writable: true,
      configurable: true,
    });
    const before = i18next.resolvedLanguage;
    i18next.resolvedLanguage = 'en';

    try {
      mockDb.select.mockResolvedValueOnce([]);

      await initPreferences();

      const seedCall = mockDb.execute.mock.calls.find(
        (c) => {
          const params = c[1] as unknown[] | undefined;
          return params && params[0] === 'language';
        }
      );
      const params = seedCall![1] as unknown[];
      expect(params[1]).toBe('en');
      expect(params[2]).toBe(0); // la langue du cloud l'emporte toujours
    } finally {
      i18next.resolvedLanguage = before;
    }
  });

  // ──────────────────────────────────────────────
  // 13. safeJsonParse null/corrupted
  // ──────────────────────────────────────────────
  it('safeJsonParse — null → fallback, string invalide → fallback + console.error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Cas null : pas de valeur dans le cache → fallback defaults
    const prefs = getCarouselPreferences();
    expect(prefs.disabledCarousels).toEqual([]);
    expect(prefs.enabledGenres).toEqual([28, 35]);
    expect(prefs.filterExoticScripts).toBe(true);

    // Cas corrupted : charger des valeurs corrompues dans le cache via init
    resetPreferencesCache();
    dispatchSpy.mockClear();

    mockDb.select.mockResolvedValueOnce([
      { key: 'disabled_carousels', value: 'NOT_JSON!' },
      { key: 'language', value: 'fr' },
    ]);
    await initPreferences();

    const prefs2 = getCarouselPreferences();
    // Fallback sur le default
    expect(prefs2.disabledCarousels).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Corrupted JSON'),
      expect.anything()
    );

    consoleErrorSpy.mockRestore();
  });

  // ──────────────────────────────────────────────
  // 14. computeProviderHash — SHA-256 déterministe
  // ──────────────────────────────────────────────
  it('computeProviderHash — retourne un hash SHA-256 hex de 64 caractères', async () => {
    const hash = await computeProviderHash(KNOWN_HOST);

    // Hash hex = 64 caractères
    expect(hash).toHaveLength(64);
    // Hex uniquement
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Déterministe : même input → même output
    const hash2 = await computeProviderHash(KNOWN_HOST);
    expect(hash2).toBe(hash);
  });

  // ──────────────────────────────────────────────
  // 15. Fournisseur de CET appareil
  // ──────────────────────────────────────────────
  it("getLastProviderHash — fournisseur de l'appareil, pas celui qu'un autre appareil a synchronisé", async () => {
    const answer = (rows: { key: string; value: string }[]) => async (sql: string) => {
      if (sql.includes('FROM meta')) return [{ value: 'provider-a.example' }];
      return rows;
    };
    mockDb.select.mockImplementation(answer([{ key: 'last_provider_hash', value: 'hash-autre-appareil' }]));
    await initPreferences();
    const deviceHash = await computeProviderHash('provider-a.example');
    expect(getLastProviderHash()).toBe(deviceHash);

    // La synchro ramène le fournisseur d'un autre appareil du compte : l'appareil garde le sien
    mockDb.select.mockImplementation(answer([{ key: 'last_provider_hash', value: 'hash-encore-autre' }]));
    await refreshPreferencesCache();
    expect(getLastProviderHash()).toBe(deviceHash);

    // Changement d'adresse sur cet appareil : la nouvelle empreinte prend la place
    await setLastProviderHash('provider-b.example');
    expect(getLastProviderHash()).toBe(await computeProviderHash('provider-b.example'));
  });

  it("getLastProviderHash — adresse de l'appareil inconnue : empreinte enregistrée", async () => {
    mockDb.select.mockImplementation(async (sql: string) => (
      sql.includes('FROM meta') ? [] : [{ key: 'last_provider_hash', value: 'hash-enregistre' }]
    ));
    await initPreferences();
    expect(getLastProviderHash()).toBe('hash-enregistre');
  });

  it("déconnexion pendant l'initialisation : rien du compte précédent dans le cache du suivant", async () => {
    let answer: (rows: unknown[]) => void = () => {};
    mockDb.select.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const init = initPreferences(); // compte A
    await new Promise((resolve) => setTimeout(resolve, 0));
    resetPreferencesCache(); // déconnexion de A
    answer([{ key: 'home_page', value: 'live' }]);
    await init;

    expect(getHomePage()).not.toBe('live');
    // L'initialisation du compte suivant a bien lieu
    mockDb.select.mockResolvedValue([{ key: 'home_page', value: 'watchlist' }]);
    await initPreferences();
    expect(getHomePage()).toBe('watchlist');
  });
});
