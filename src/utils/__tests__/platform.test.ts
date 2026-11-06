// Mode téléphone forcé (banc de tests) : l'interface téléphone sous Linux ou Windows, sans toucher
// aux capacités natives de l'appareil ; jamais lu dans une version publiée.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'linux' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import {
  isMobile, isMobileDevice, isPhoneOverrideEnabled, setPhoneMode, setTvMode, usesNyxPlugin, PHONE_OVERRIDE_KEY,
} from '../platform';

afterEach(() => {
  setPhoneMode(false);
  setTvMode(false);
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe('mode téléphone forcé', () => {
  it('un bureau n\'est pas un téléphone, sauf forçage', () => {
    expect(isMobile()).toBe(false);
    setPhoneMode(true);
    expect(isMobile()).toBe(true);
    // Les capacités natives restent celles du bureau (fenêtre, commandes Rust)
    expect(isMobileDevice()).toBe(false);
  });

  it('un bureau ne passe pas par le plugin natif', () => {
    expect(usesNyxPlugin()).toBe(false);
    setPhoneMode(true);
    expect(usesNyxPlugin()).toBe(false);
  });

  it('l\'interface TV l\'emporte sur le forçage téléphone', () => {
    setPhoneMode(true);
    setTvMode(true);
    expect(isMobile()).toBe(false);
  });

  it('la clé n\'est lue qu\'en développement ou en version d\'audit', () => {
    localStorage.setItem(PHONE_OVERRIDE_KEY, 'true');
    vi.stubEnv('DEV', true);
    expect(isPhoneOverrideEnabled()).toBe(true);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_AUDIT', '1');
    expect(isPhoneOverrideEnabled()).toBe(true);
    // Version publiée : jamais
    vi.stubEnv('VITE_AUDIT', '');
    expect(isPhoneOverrideEnabled()).toBe(false);
  });
});
