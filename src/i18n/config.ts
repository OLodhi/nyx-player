import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import type { BackendModule, ResourceLanguage } from 'i18next';
import { createLogger } from '../utils/logger';

const log = createLogger('i18n');

/**
 * Textes chargés à la demande, une langue à la fois (démarrage plus léger) : seuls ceux de la
 * langue affichée sont lus au lancement, l'autre langue arrive à son premier choix. Chaque langue est
 * un bloc à part du bundle (`locales/<langue>/index.ts`), lu depuis l'app : aucun réseau.
 */
const LOADERS: Record<string, () => Promise<{ default: ResourceLanguage }>> = {
  fr: () => import('./locales/fr'),
  en: () => import('./locales/en'),
};

/** Tous les espaces de textes, chargés ensemble avec leur langue (aucun écran n'attend le sien) */
export const NAMESPACES = ['common', 'dashboard', 'settings', 'player', 'auth', 'navigation', 'details', 'search', 'tv'] as const;

const loading = new Map<string, Promise<ResourceLanguage>>();

function loadLanguage(language: string): Promise<ResourceLanguage> {
  let pending = loading.get(language);
  if (!pending) {
    pending = LOADERS[language]().then((mod) => mod.default);
    // Un échec n'est pas gardé : le choix suivant de la langue réessaie
    pending.catch(() => loading.delete(language));
    loading.set(language, pending);
  }
  return pending;
}

const lazyLocales: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    // Code sans textes propres (« fr-FR », « de ») : rien à lire, la langue de base ou de repli sert
    if (!LOADERS[language]) {
      callback(null, {});
      return;
    }
    loadLanguage(language).then(
      (texts) => callback(null, texts[namespace] ?? {}),
      (error: Error) => {
        // Très improbable (bloc intégré à l'app) ; l'écran afficherait les noms des clés
        log.error(`Textes « ${language} » illisibles`, error);
        callback(error, null);
      },
    );
  },
};

const defaultNS = 'common';

/**
 * Dernière langue affichée sur cet appareil. La langue choisie dans les Paramètres est rangée dans la
 * base du compte, qui ne s'ouvre qu'après le choix du profil : sans ce rappel, l'écran « Qui
 * regarde ? » et le chargement suivaient la langue du système (Chromecast). La base du
 * compte reste la référence : sa langue est appliquée dès l'ouverture du profil, puis rappelée ici.
 */
export const LANGUAGE_STORAGE_KEY = 'nyx_language';

/**
 * Prêt quand les textes de la langue de départ sont chargés : le démarrage l'attend avant le premier
 * rendu (main.tsx), comme quand tous les textes étaient dans le bundle.
 */
export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    debug: import.meta.env.DEV, // Logs info in dev mode
    // L'anglais sert aux langues sans textes (« de »…). Le français n'a pas de repli : il a toutes les
    // clés de l'anglais (test locales.test.ts), et un repli chargerait aussi l'anglais à chaque lancement.
    fallbackLng: { fr: [], default: ['en'] },
    ns: [...NAMESPACES],
    defaultNS,
    interpolation: {
      escapeValue: false, // React already safe from XSS
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

export default i18n;
