/**
 * Réglages > Accueil à la télécommande : les rangées système et les genres étaient des `div` avec un
 * simple `onClick`, hors du parcours de la navigation TV (qui ne s'arrête que sur un élément
 * focusable) : impossible d'activer ou de couper une rangée sur Android TV. Ils sont maintenant des
 * boutons pour la navigation, activés par OK (« Enter »), et gardent leur clic à la souris.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const prefs = vi.hoisted(() => ({ toggleCarousel: vi.fn(), toggleGenre: vi.fn() }));

vi.mock('../../../services/preferencesService', () => ({
  getCarouselPreferences: () => ({ disabledCarousels: [], enabledGenres: [28] }),
  isCarouselEnabled: () => true,
  isGenreEnabled: (id: number) => id === 28,
  toggleCarousel: prefs.toggleCarousel,
  toggleGenre: prefs.toggleGenre,
  isExoticFilterEnabled: () => false,
  setExoticFilter: vi.fn(),
  getDashboardDefaultMode: () => 'suggestions',
  setDashboardDefaultMode: vi.fn(),
}));

import { i18nReady } from '../../../i18n/config';
import SettingsCarousels from '../SettingsCarousels';

const chip = (id: string) => document.querySelector<HTMLElement>(`[data-testid="settings-carousel-chip"][data-carousel-id="${id}"]`)!;
const tile = (id: number) => document.querySelector<HTMLElement>(`[data-testid="settings-genre-tile"][data-genre-id="${id}"]`)!;

describe('Réglages > Accueil : rangées et genres à la télécommande', () => {
  beforeAll(async () => { await i18nReady; });
  beforeEach(async () => {
    prefs.toggleCarousel.mockClear();
    prefs.toggleGenre.mockClear();
    await act(async () => { render(<SettingsCarousels />); });
  });

  it('une rangée système est un arrêt de la navigation TV, activé par OK', () => {
    const c = chip('popular');
    expect(c.getAttribute('role')).toBe('button');
    expect(c.tabIndex).toBe(0);
    expect(c.getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(c, { key: 'Enter' });
    expect(prefs.toggleCarousel).toHaveBeenCalledWith('popular');
  });

  it('un genre est un arrêt de la navigation TV, activé par OK', () => {
    const g = tile(28);
    expect(g.getAttribute('role')).toBe('button');
    expect(g.tabIndex).toBe(0);
    expect(g.getAttribute('aria-pressed')).toBe('true');
    expect(tile(12).getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(g, { key: 'Enter' });
    expect(prefs.toggleGenre).toHaveBeenCalledWith(28);
  });

  it('le clic de la souris marche toujours', () => {
    fireEvent.click(chip('trending'));
    fireEvent.click(tile(35));
    expect(prefs.toggleCarousel).toHaveBeenCalledWith('trending');
    expect(prefs.toggleGenre).toHaveBeenCalledWith(35);
    expect(screen.getAllByTestId('settings-genre-tile').length).toBeGreaterThan(10);
  });
});
