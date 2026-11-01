/**
 * Tests : l'interface est montée même si la préparation du démarrage échoue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runStartup } from '../startup';

describe('runStartup', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('prépare la plateforme puis monte, dans cet ordre', async () => {
    const order: string[] = [];
    await runStartup(Promise.resolve(), () => order.push('platform'), () => order.push('mount'));
    expect(order).toEqual(['platform', 'mount']);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("monte l'interface quand la détection de l'appareil échoue", async () => {
    const platform = vi.fn();
    const mount = vi.fn();
    await runStartup(Promise.reject(new Error('plugin indisponible')), platform, mount);
    expect(platform).toHaveBeenCalledOnce();
    expect(mount).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('monte l\'interface quand le réglage de la plateforme lève une erreur', async () => {
    const mount = vi.fn();
    await runStartup(Promise.resolve(), () => { throw new Error('toile TV'); }, mount);
    expect(mount).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalled();
  });
});
