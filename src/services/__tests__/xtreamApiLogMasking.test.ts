/**
 * Tests : la réponse invalide journalisée par XtreamApiService ne contient jamais les identifiants,
 * même quand la troncature à 100 caractères tombe au milieu d'une valeur.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

const iptvFetchMock = vi.fn<(url: string) => Promise<string>>();
vi.mock('../networkService', () => ({
  iptvFetch: (url: string) => iptvFetchMock(url),
}));

import { XtreamApiService } from '../xtreamApi';

const creds = { host: 'http://provider.example:8080', username: 'jean.dupont', password: 'S3cr3t/&#pass' };

describe('XtreamApiService : masquage de la réponse invalide journalisée', () => {
  let warnSpy: MockInstance<typeof console.warn>;

  beforeEach(() => {
    iptvFetchMock.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function loggedText(): string {
    return warnSpy.mock.calls.map((args) => args.join(' ')).join('\n');
  }

  it('masque le mot de passe JSON coupé par la troncature', async () => {
    // Le mot de passe commence juste avant le 100e caractère : tronquer d'abord laisserait « "password":"S3cr3t » sans guillemet final.
    const prefix = '{"user_info":{"username":"jean.dupont","padding":"' + 'x'.repeat(30) + '",';
    const body = prefix + '"password":"S3cr3t/&#pass","status":"Active"} <html>';
    iptvFetchMock.mockResolvedValue(body);

    const api = new XtreamApiService(creds);
    await expect(api.getLiveStreams()).resolves.toEqual([]);

    const logged = loggedText();
    expect(logged).toContain('Invalid JSON response');
    expect(logged).not.toContain('S3c');
    expect(logged).not.toContain('jean.dupont');
  });

  it("masque les identifiants exacts du compte même sous une forme inconnue", async () => {
    iptvFetchMock.mockResolvedValue('<html>Erreur pour jean.dupont / S3cr3t/&#pass</html>');

    const api = new XtreamApiService(creds);
    await api.getLiveStreams();

    const logged = loggedText();
    expect(logged).not.toContain('jean.dupont');
    expect(logged).not.toContain('S3cr3t');
    expect(logged).toContain('<html>Erreur pour *** / ***</html>');
  });

  it('journalise toujours un extrait limité à 100 caractères', async () => {
    iptvFetchMock.mockResolvedValue('<' + 'a'.repeat(500));

    const api = new XtreamApiService(creds);
    await api.getLiveStreams();

    const snippet = warnSpy.mock.calls[0]?.[1] as string;
    expect(snippet).toHaveLength(100);
  });
});
