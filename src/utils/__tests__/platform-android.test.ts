// Vrai téléphone et vraie TV Android : le mode téléphone forcé du banc ne change rien pour eux.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'android' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { isMobile, isMobileDevice, setPhoneMode, setTvMode, usesNyxPlugin } from '../platform';

afterEach(() => {
  setPhoneMode(false);
  setTvMode(false);
});

describe('appareil Android', () => {
  it('un téléphone est un téléphone, pour l\'interface comme pour les capacités natives', () => {
    expect(isMobile()).toBe(true);
    expect(isMobileDevice()).toBe(true);
  });

  it('une TV n\'est pas un téléphone, même avec le forçage', () => {
    setTvMode(true);
    setPhoneMode(true);
    expect(isMobile()).toBe(false);
    expect(isMobileDevice()).toBe(false);
  });

  it('Android, TV comprise, passe par le plugin natif', () => {
    expect(usesNyxPlugin()).toBe(true);
    setTvMode(true);
    expect(usesNyxPlugin()).toBe(true);
  });
});
