/**
 * Changement de langue dans les Réglages : le cache TMDB n'est plus
 * vidé en entier avant le changement ; `ensureCacheLanguage` ne vide que ce qui dépend de la langue
 * et garde nom et affiche des titres de Ma liste.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { order, cache, i18n } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    cache: {
      clearAllCache: vi.fn(async () => { order.push('clearAllCache'); }),
      ensureCacheLanguage: vi.fn(async (lang: string) => { order.push(`ensureCacheLanguage:${lang}`); return true; }),
    },
    i18n: {
      resolvedLanguage: 'fr',
      changeLanguage: vi.fn(async (lang: string) => { order.push(`changeLanguage:${lang}`); i18n.resolvedLanguage = lang; }),
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n }),
}));
vi.mock('../../../services/tmdbCacheSqlite', () => cache);
vi.mock('../../../utils/tmdbLanguage', () => ({
  getTmdbLanguage: () => (i18n.resolvedLanguage === 'en' ? 'en-US' : 'fr-FR'),
}));
vi.mock('../../../hooks/useDashboardData', () => ({
  resetDashboardCache: vi.fn(() => { order.push('resetDashboardCache'); }),
}));
vi.mock('../../../services/preferencesService', () => ({
  setLanguage: vi.fn(() => { order.push('setLanguage'); }),
}));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
// Liste déroulante réduite à un bouton par valeur proposée
vi.mock('../../Common/NyxDropdown', () => ({
  default: ({ options, onChange }: { options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
    <div>{options.map((o) => <button key={o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}</div>
  ),
}));

import GeneralSection from '../GeneralSection';
import { TMDB_LANGUAGE_EVENT } from '../../../services/eventConstants';

const noop = () => {};

beforeEach(() => {
  order.length = 0;
  i18n.resolvedLanguage = 'fr';
  vi.clearAllMocks();
});

describe('GeneralSection — langue', () => {
  it('switching to English keeps Ma liste in the cache: no full wipe, only the language check', async () => {
    const onLanguage = vi.fn();
    window.addEventListener(TMDB_LANGUAGE_EVENT, onLanguage);
    render(
      <GeneralSection
        homePage="dashboard" onHomePageChange={noop}
        dnsProvider="system" onDnsProviderChange={noop}
        bingeMode={false} onBingeModeChange={noop} bingeCountdown={10} onBingeCountdownChange={noop}
        geekStats={false} onGeekStatsChange={noop}
        hwAccel={false} hwAccelLoaded={false} onHwAccelChange={async () => {}}
      />,
    );

    fireEvent.click(screen.getByText('English'));

    await waitFor(() => expect(order).toContain('setLanguage'));
    expect(cache.clearAllCache).not.toHaveBeenCalled();
    expect(order).toEqual(['resetDashboardCache', 'changeLanguage:en', 'ensureCacheLanguage:en-US', 'setLanguage']);
    await waitFor(() => expect(onLanguage).toHaveBeenCalledTimes(1));
    window.removeEventListener(TMDB_LANGUAGE_EVENT, onLanguage);
  });
});
