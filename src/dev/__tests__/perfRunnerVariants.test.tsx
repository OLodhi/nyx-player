/**
 * Écran des profils de la version de mesure : la liste des variantes suit un réglage fait à distance, et forme une
 * zone à part que la télécommande parcourt en entier par Haut / Bas.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { PerfRunner } from '../perfRunner/PerfRunner';
import { applyVariants } from '../perfVariants';

afterEach(() => {
  applyVariants(new Set());
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function showProfiles() {
  vi.useFakeTimers();
  const profiles = document.createElement('div');
  profiles.className = 'profile-selector';
  document.body.appendChild(profiles);
  render(<PerfRunner />);
  act(() => { vi.advanceTimersByTime(600); });
}

describe('variantes sur l’écran des profils', () => {
  it('un réglage fait à distance met à jour les boutons affichés', () => {
    showProfiles();
    const v1 = screen.getByRole('button', { name: /Aucun autre flou/ });
    expect(v1.getAttribute('aria-pressed')).toBe('false');
    act(() => applyVariants(new Set(['no-blur'])));
    expect(v1.getAttribute('aria-pressed')).toBe('true');
    expect(v1.textContent?.startsWith('OUI')).toBe(true);
  });

  it('le panneau est une zone à part (Haut / Bas y restent), pas posé sur les boutons de la page', () => {
    showProfiles();
    const panel = document.querySelector<HTMLElement>('.perf-runner-start');
    expect(panel?.dataset.navZone).toBe('aside');
    expect(panel?.style.bottom).toBe('');
  });
});
