import 'i18next';
import common from '../i18n/locales/fr/common.json';
import dashboard from '../i18n/locales/fr/dashboard.json';
import settings from '../i18n/locales/fr/settings.json';
import player from '../i18n/locales/fr/player.json';
import auth from '../i18n/locales/fr/auth.json';
import navigation from '../i18n/locales/fr/navigation.json';
import details from '../i18n/locales/fr/details.json';
import search from '../i18n/locales/fr/search.json';
import tv from '../i18n/locales/fr/tv.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      dashboard: typeof dashboard;
      settings: typeof settings;
      player: typeof player;
      auth: typeof auth;
      navigation: typeof navigation;
      details: typeof details;
      search: typeof search;
      tv: typeof tv;
    };
  }
}
