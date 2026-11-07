/**
 * Type de connexion : lu par le plugin natif sur Android et iOS, supposé non limité sur ordinateur
 * ou quand le plugin ne répond pas (l'app ne doit jamais se bloquer là-dessus).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
let platform: 'android' | 'ios' | 'windows' = 'windows';

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../utils/platform', () => ({
  isAndroid: () => platform === 'android',
  usesNyxPlugin: () => platform !== 'windows',
}));

import { getNetworkStatus } from '../networkStatus';

const DESKTOP = { connected: true, metered: false, type: 'other' };

describe('getNetworkStatus', () => {
  beforeEach(() => {
    invoke.mockReset();
    platform = 'windows';
  });

  it('ordinateur : connexion supposée non limitée, sans appel natif', async () => {
    expect(await getNetworkStatus()).toEqual(DESKTOP);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('iOS : état lu par le plugin', async () => {
    platform = 'ios';
    invoke.mockResolvedValueOnce({ connected: true, metered: true, type: 'cellular' });
    expect(await getNetworkStatus()).toEqual({ connected: true, metered: true, type: 'cellular' });
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|network_status');
  });

  it('iOS, plugin en échec : connexion supposée non limitée', async () => {
    platform = 'ios';
    invoke.mockRejectedValueOnce(new Error('plugin indisponible'));
    expect(await getNetworkStatus()).toEqual(DESKTOP);
  });
});
