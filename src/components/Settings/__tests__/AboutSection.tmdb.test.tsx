/**
 * Les conditions de l'API TMDB exigent une mention dans l'app. Elle figure dans Paramètres →
 * À propos, avec les vrais textes français et anglais (pas le nom de la clé), sur toutes les
 * plateformes (bureau, téléphone, TV).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const platform = vi.hoisted(() => ({ mobile: false }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.0.0') }));
vi.mock('@sentry/react', () => ({ captureFeedback: vi.fn() }));
vi.mock('../../../contexts/UpdaterContext', () => ({
  useUpdater: () => ({ status: 'idle', version: null, checkForUpdate: vi.fn() }),
}));
vi.mock('../../../contexts/DevOverrideContext', () => ({
  useDevOverrides: () => ({ overrides: { settingsPage: {} } }),
}));
vi.mock('../../../utils/platform', () => ({ isMobile: () => platform.mobile, isAndroid: () => false }));
vi.mock('../ThirdPartyLicensesModal', () => ({ default: () => null }));

import i18n, { i18nReady } from '../../../i18n/config';
import AboutSection from '../AboutSection';

const FR = "Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.";
const EN = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

async function renderIn(lang: 'fr' | 'en') {
  await i18nReady;
  await act(async () => { await i18n.changeLanguage(lang); });
  await act(async () => { render(<AboutSection />); });
}

describe('À propos — mention TMDB', () => {
  const initialLanguage = i18n.language;
  beforeAll(async () => { await i18nReady; });
  afterAll(async () => { await i18n.changeLanguage(initialLanguage); });
  beforeEach(() => { platform.mobile = false; });

  it('affiche la mention en français', async () => {
    await renderIn('fr');
    expect(screen.getByTestId('settings-about-tmdb')).toHaveTextContent(FR);
  });

  it('affiche la mention en anglais', async () => {
    await renderIn('en');
    expect(screen.getByTestId('settings-about-tmdb')).toHaveTextContent(EN);
  });

  it('reste affichée sur téléphone et TV', async () => {
    platform.mobile = true;
    await renderIn('fr');
    expect(screen.getByTestId('settings-about-tmdb')).toHaveTextContent(FR);
  });

  it('montre le logo officiel de TMDB, au-dessus de la mention', async () => {
    await renderIn('fr');
    const logo = screen.getByTestId('settings-about-tmdb-logo');
    expect(logo.tagName).toBe('IMG');
    expect(logo).toHaveAttribute('alt', 'TMDB');
    // Petit SVG : Vite l'intègre à la page (data:) ; sa boîte 273.42 × 35.52 est celle du logo officiel.
    expect(logo.getAttribute('src')).toMatch(/tmdb-logo-blue-short|273\.42/);
    expect(logo.compareDocumentPosition(screen.getByTestId('settings-about-tmdb')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
