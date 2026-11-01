/**
 * Réglages > À propos à la télécommande : les liens légaux (conditions, confidentialité, mentions)
 * étaient de simples `span` avec un `onClick`, hors du parcours de la navigation TV : impossibles à
 * ouvrir sur Android TV. Ils sont maintenant des boutons pour la navigation, ouverts par OK.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const opener = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => opener);
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '0.0.0') }));
vi.mock('@sentry/react', () => ({ captureFeedback: vi.fn() }));
vi.mock('../../../contexts/UpdaterContext', () => ({
  useUpdater: () => ({ status: 'idle', version: null, checkForUpdate: vi.fn() }),
}));
vi.mock('../../../contexts/DevOverrideContext', () => ({
  useDevOverrides: () => ({ overrides: { settingsPage: {} } }),
}));
vi.mock('../ThirdPartyLicensesModal', () => ({ default: () => null }));

import i18n, { i18nReady } from '../../../i18n/config';
import AboutSection from '../AboutSection';
import LinkFallback from '../../Common/LinkFallback';

describe('À propos : liens légaux à la télécommande', () => {
  beforeAll(async () => { await i18nReady; });

  it.each([
    ['settings-legal-terms', 'https://nyxplayer.app/terms.html'],
    ['settings-legal-notices', 'https://nyxplayer.app/legal.html'],
  ])('%s est un arrêt de la navigation TV, ouvert par OK', async (id, url) => {
    await act(async () => { render(<AboutSection />); });
    const lien = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    expect(lien.getAttribute('role')).toBe('button');
    expect(lien.tabIndex).toBe(0);
    opener.openUrl.mockClear();
    fireEvent.keyDown(lien, { key: 'Enter' });
    expect(opener.openUrl).toHaveBeenCalledWith(url);
  });

  it('la politique de confidentialité aussi', async () => {
    await act(async () => { render(<AboutSection />); });
    const lien = document.querySelector<HTMLElement>('[data-testid="settings-legal-privacy"]')!;
    expect(lien.tabIndex).toBe(0);
    opener.openUrl.mockClear();
    fireEvent.keyDown(lien, { key: 'Enter' });
    expect(opener.openUrl).toHaveBeenCalledTimes(1);
  });

  it('en français, les conditions s’ouvrent sur leur page française', async () => {
    const avant = i18n.language;
    await act(async () => { await i18n.changeLanguage('fr'); });
    try {
      await act(async () => { render(<AboutSection />); });
      const lien = document.querySelector<HTMLElement>('[data-testid="settings-legal-terms"]')!;
      opener.openUrl.mockClear();
      fireEvent.keyDown(lien, { key: 'Enter' });
      expect(opener.openUrl).toHaveBeenCalledWith('https://nyxplayer.app/conditions.html');
    } finally {
      await act(async () => { await i18n.changeLanguage(avant); });
    }
  });

  it('sans navigateur (TV), l\'adresse du lien s\'affiche dans une fenêtre, fermée par Fermer', async () => {
    opener.openUrl.mockReset();
    opener.openUrl.mockRejectedValueOnce(new Error('aucune application pour ouvrir ce lien'));
    await act(async () => { render(<><AboutSection /><LinkFallback /></>); });
    const lien = document.querySelector<HTMLElement>('[data-testid="settings-legal-terms"]')!;
    await act(async () => { fireEvent.keyDown(lien, { key: 'Enter' }); });

    const fenetre = await screen.findByTestId('link-fallback');
    expect(fenetre).toHaveTextContent('https://nyxplayer.app/terms.html');
    // Sous <body>, après la fenêtre des licences : au-dessus d'elle, et retenue par la télécommande
    expect(fenetre.closest('[data-nav-layer="modal"]')?.parentElement).toBe(document.body);
    fireEvent.click(screen.getByTestId('confirm-modal-cancel'));
    await waitFor(() => expect(screen.queryByTestId('link-fallback')).toBeNull());
  });
});
