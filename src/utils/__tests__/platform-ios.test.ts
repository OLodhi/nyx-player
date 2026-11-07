// iPhone et iPad : même couche native que sur Android (le plugin nyx-android), interface tactile,
// jamais une TV.
import { describe, it, expect, vi, afterEach } from 'vitest';

const invoke = vi.fn();

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'ios' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { detectDeviceType, isAndroid, isMobile, isMobileDevice, isTv, setPhoneMode, setTvMode, usesNyxPlugin } from '../platform';

afterEach(() => {
  setPhoneMode(false);
  setTvMode(false);
  invoke.mockReset();
});

describe('appareil iOS', () => {
  it('iOS passe par le plugin natif', () => {
    expect(usesNyxPlugin()).toBe(true);
    expect(isAndroid()).toBe(false);
  });

  it('iOS : interface tactile', () => {
    expect(isMobile()).toBe(true);
    expect(isMobileDevice()).toBe(true);
  });

  it('iOS : pas de détection TV (device_info non appelé)', async () => {
    await detectDeviceType();
    expect(invoke).not.toHaveBeenCalled();
    expect(isTv()).toBe(false);
  });
});
