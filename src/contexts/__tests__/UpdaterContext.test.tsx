/**
 * Outils de test des mises à jour : présents en développement, absents de la version
 * publiée ; valeur du contexte stable d'un rendu à l'autre.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';

vi.mock('../../services/appUpdateCheck', () => ({ checkForAppUpdate: vi.fn().mockResolvedValue(null) }));
vi.mock('../../utils/platform', () => ({ isMobile: () => true, isAndroid: () => false }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { UpdaterProvider, useUpdater } from '../UpdaterContext';
import type { AppUpdaterState } from '../../hooks/useAppUpdater';

const seen: AppUpdaterState[] = [];
/** Valeur vue au rendu n-ième en partant de la fin (1 = dernier) */
const last = (n = 1) => seen[seen.length - n];
const Probe: React.FC = () => {
  seen.push(useUpdater());
  return null;
};

const mount = () => {
  const view = render(<UpdaterProvider><Probe /></UpdaterProvider>);
  return view;
};

describe('UpdaterContext', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    seen.length = 0;
  });

  it('version publiée : aucun outil de test dans la console, fausse mise à jour ignorée', () => {
    vi.stubEnv('DEV', false);
    const { unmount } = mount();
    expect(window.__simulateUpdate).toBeUndefined();
    expect(window.__dismissUpdate).toBeUndefined();
    act(() => {
      window.dispatchEvent(new CustomEvent('__dev-simulate-update', { detail: { version: '99.0.0' } }));
    });
    expect(last()?.status).toBe('idle');
    unmount();
  });

  it('développement : les outils de test marchent comme avant', () => {
    vi.stubEnv('DEV', true);
    const { unmount } = mount();
    expect(typeof window.__simulateUpdate).toBe('function');
    act(() => window.__simulateUpdate?.('9.9.9'));
    expect(last()?.status).toBe('available');
    expect(last()?.version).toBe('9.9.9');
    unmount();
    expect(window.__simulateUpdate).toBeUndefined();
  });

  it('la valeur du contexte ne change pas quand rien ne change', () => {
    const { rerender, unmount } = mount();
    rerender(<UpdaterProvider><Probe /></UpdaterProvider>);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(last()).toBe(last(2));
    unmount();
  });
});
