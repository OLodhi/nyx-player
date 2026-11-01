/**
 * Premier focus à l'arrivée sur une page, à la télécommande : la sélection est sur l'icône de
 * la page dans la barre latérale. Avant, à l'ouverture de l'app (après le choix du profil, ou sur la
 * page de démarrage) rien n'était sélectionné, et après un Retour depuis la barre la sélection
 * restait sur l'icône de la page quittée.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { setTvMode } from '../../../utils/platform';
import type { TabType } from '../../../contexts/NavigationContext';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const props = { onTabChange: vi.fn(), onLogout: vi.fn() };

/** Le tour suivant (le hook pose le focus après le rendu) */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const tab = (id: TabType) => document.querySelector<HTMLElement>(`[data-tab="${id}"]`);

describe('barre latérale : focus à l\'arrivée sur une page (télécommande)', () => {
  let restoreRect: () => void = () => {};

  beforeEach(() => {
    // jsdom ne calcule pas de mise en page : chaque bouton a une taille, sinon il n'est pas atteignable
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 60, bottom: 60, width: 60, height: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    restoreRect = () => { HTMLElement.prototype.getBoundingClientRect = original; };
    setTvMode(true);
  });

  afterEach(() => {
    setTvMode(false);
    restoreRect();
    document.body.innerHTML = '';
  });

  it("ouverture de l'app (rien de sélectionné) : focus sur l'icône de la page", async () => {
    render(<Sidebar activeTab="live" {...props} />);
    await nextFrame();
    expect(document.activeElement).toBe(tab('live'));
  });

  it("changement de page alors que la sélection est sur l'icône quittée (Retour) : suit la page", async () => {
    const view = render(<Sidebar activeTab="live" {...props} />);
    await nextFrame();
    tab('watchlist')!.focus();
    view.rerender(<Sidebar activeTab="dashboard" {...props} />);
    await nextFrame();
    expect(document.activeElement).toBe(tab('dashboard'));
  });

  it('une page qui pose son propre focus (champ de la Recherche) le garde', async () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    const view = render(<Sidebar activeTab="dashboard" {...props} />);
    await nextFrame();
    view.rerender(<Sidebar activeTab="search" {...props} />);
    field.focus();
    await nextFrame();
    expect(document.activeElement).toBe(field);
  });

  it('hors TV : rien ne change', async () => {
    setTvMode(false);
    render(<Sidebar activeTab="live" {...props} />);
    await nextFrame();
    expect(document.activeElement).toBe(document.body);
  });
});
