/**
 * Plugin Android : l'écouteur d'erreurs de lecture est réessayé si son attachement échoue.
 */

import { describe, it, expect, vi } from 'vitest';

const { addPluginListener } = vi.hoisted(() => ({ addPluginListener: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined), addPluginListener }));

import { init } from '../androidPlayer';

describe('androidPlayer — écouteur d\'erreurs', () => {
  it('un échec d\'attachement est retenté au lancement suivant, puis plus rien', async () => {
    addPluginListener.mockRejectedValueOnce(new Error('bridge not ready'));
    await expect(init()).rejects.toThrow('bridge not ready');

    addPluginListener.mockResolvedValueOnce({ unregister: vi.fn() });
    await expect(init()).resolves.toBe('main');
    await init();
    expect(addPluginListener).toHaveBeenCalledTimes(2);
  });

  it('deux lancements simultanés n\'attachent qu\'un écouteur', async () => {
    vi.resetModules();
    addPluginListener.mockReset();
    let resolve: (value: unknown) => void = () => {};
    addPluginListener.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const { init: freshInit } = await import('../androidPlayer');
    const first = freshInit();
    const second = freshInit();
    resolve({ unregister: vi.fn() });
    await Promise.all([first, second]);
    expect(addPluginListener).toHaveBeenCalledTimes(1);
  });
});
