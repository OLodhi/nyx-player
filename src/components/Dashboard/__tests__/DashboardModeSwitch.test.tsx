/**
 * Onglets de l'accueil : à place gardée (TV, pendant le chargement), ils sont cachés, hors d'atteinte et sans repère
 * du banc ; sinon, les vrais onglets.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import DashboardModeSwitch from '../DashboardModeSwitch';

describe('DashboardModeSwitch', () => {
  it('onglets normaux : repères du banc, atteignables', () => {
    const { container } = render(<DashboardModeSwitch activeMode="suggestions" onModeChange={() => {}} />);
    expect(screen.getByTestId('dashboard-mode-switch')).not.toHaveAttribute('inert');
    expect(screen.getAllByTestId('dashboard-mode')).toHaveLength(3);
    expect(container.firstElementChild).not.toHaveClass('dashboard-mode-switch--reserved');
  });

  it('place gardée : cachés, hors d\'atteinte, sans repère du banc', () => {
    const { container } = render(<DashboardModeSwitch activeMode="suggestions" onModeChange={() => {}} reserved />);
    const bar = container.firstElementChild!;
    expect(bar).toHaveClass('dashboard-mode-switch', 'dashboard-mode-switch--reserved');
    expect(bar).toHaveAttribute('inert');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('dashboard-mode-switch')).toBeNull();
    expect(screen.queryAllByTestId('dashboard-mode')).toHaveLength(0);
    // Même hauteur que les vrais onglets : mêmes boutons, hors du parcours
    const pills = screen.getAllByTestId('dashboard-mode-reserved');
    expect(pills).toHaveLength(3);
    expect(pills.every((pill) => pill.tagName === 'BUTTON' && pill.tabIndex === -1)).toBe(true);
  });
});
