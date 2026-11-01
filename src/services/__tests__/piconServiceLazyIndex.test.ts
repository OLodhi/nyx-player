/**
 * piconService — index des logos chargé à la demande.
 *
 * L'index (≈ 186 Ko) n'est plus lu au lancement : tant qu'il n'est pas chargé, la version
 * synchrone répond « en attente » sans rien mémoriser, et la version asynchrone l'attend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const cachePicon = vi.fn();
vi.mock('../piconCache', () => ({
  getCachedPicon: () => undefined,
  cachePicon: (...args: unknown[]) => cachePicon(...args),
}));

const TF1_URL = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/france/tf1-fr.png';

async function freshService() {
  vi.resetModules();
  return import('../piconService');
}

describe('piconService — index chargé à la demande', () => {
  beforeEach(() => {
    cachePicon.mockClear();
  });

  it("n'a pas chargé l'index au chargement du module", async () => {
    const service = await freshService();
    expect(service.isPiconIndexLoaded()).toBe(false);
  });

  it('répond « en attente » sans rien mémoriser tant que l\'index manque', async () => {
    const service = await freshService();
    const result = service.getPiconUrlSync('TF1 FHD [FR]', 'http://xtream/tf1.png');
    expect(result).toEqual({ url: null, isPending: true });
    expect(cachePicon).not.toHaveBeenCalled();
  });

  it("la version asynchrone attend l'index puis trouve le logo", async () => {
    const service = await freshService();
    await expect(service.getPiconUrl('TF1 FHD [FR]', 'http://xtream/tf1.png')).resolves.toBe(TF1_URL);
    expect(service.isPiconIndexLoaded()).toBe(true);
    expect(cachePicon).toHaveBeenCalledWith('tf1', TF1_URL);
  });

  it("une fois l'index chargé, la version synchrone répond tout de suite", async () => {
    const service = await freshService();
    await service.loadPiconIndex();
    expect(service.getPiconUrlSync('TF1 FHD [FR]')).toEqual({ url: TF1_URL, isPending: false });
  });

  it("chaîne absente de l'index : logo du fournisseur", async () => {
    const service = await freshService();
    await service.loadPiconIndex();
    expect(service.getPiconUrlSync('Chaine Inconnue XYZ', 'http://xtream/x.png'))
      .toEqual({ url: 'http://xtream/x.png', isPending: false });
    expect(cachePicon).toHaveBeenCalledWith(expect.any(String), null);
  });

  it("charge l'index une seule fois pour des demandes simultanées", async () => {
    const service = await freshService();
    const first = service.loadPiconIndex();
    const second = service.loadPiconIndex();
    expect(second).toBe(first);
    await first;
  });
});
