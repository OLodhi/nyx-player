/**
 * Sortie de l'app à la télécommande : depuis que l'app s'ouvre avec l'icône
 * de la page sélectionnée dans la barre latérale, un seul Retour la fermait. Le premier Retour affiche
 * maintenant « Appuyez encore sur Retour pour quitter » ; seul un second, dans le délai, quitte.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { dispatchBack } from '../../hooks/useBackHandler';
import { EXIT_CONFIRM_MS, installSpatialNavigation } from '../spatialNavigation';
import TvExitNotice from '../../components/Common/TvExitNotice';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** Barre latérale avec l'icône de la page courante, sélectionnée (arrivée sur une page) */
function sidebarFocused(): void {
  const sidebar = document.createElement('div');
  sidebar.setAttribute('data-nav-zone', 'sidebar');
  const home = document.createElement('button');
  home.className = 'active';
  home.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 60, bottom: 60, width: 60, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  sidebar.appendChild(home);
  document.body.appendChild(sidebar);
  home.focus();
}

describe('Retour pour quitter l\'app (télécommande)', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    uninstall = installSpatialNavigation();
    sidebarFocused();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('premier Retour depuis la barre : message, l\'app reste ouverte ; second Retour dans le délai : quitte', () => {
    render(<TvExitNotice />);
    let kept = false;
    act(() => { kept = dispatchBack(); });
    expect(kept).toBe(true);
    expect(screen.getByTestId('exit-confirm-notice').textContent).toBe('press_back_again_to_exit');
    expect(dispatchBack()).toBe(false);
    // Le message part seul après le délai
    act(() => { vi.advanceTimersByTime(EXIT_CONFIRM_MS + 100); });
    expect(screen.getByTestId('exit-confirm-notice').textContent).toBe('');
  });

  it('second Retour après le délai : nouveau message, toujours pas de sortie', () => {
    render(<TvExitNotice />);
    act(() => { dispatchBack(); });
    act(() => { vi.advanceTimersByTime(EXIT_CONFIRM_MS + 100); });
    expect(screen.getByTestId('exit-confirm-notice').textContent).toBe('');
    let kept = false;
    act(() => { kept = dispatchBack(); });
    expect(kept).toBe(true);
    expect(screen.getByTestId('exit-confirm-notice').textContent).toBe('press_back_again_to_exit');
  });

  it('sans barre latérale (connexion, profils) : même confirmation', () => {
    document.body.innerHTML = '';
    expect(dispatchBack()).toBe(true);
    expect(dispatchBack()).toBe(false);
  });
});
