/**
 * Tests : adresses Xtream avec identifiants spéciaux et cache des séries sans épisode.
 * Identifiants factices.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const iptvFetchMock = vi.fn<(url: string) => Promise<string>>();
vi.mock('../networkService', () => ({
  iptvFetch: (url: string) => iptvFetchMock(url),
}));

const getCachedMock = vi.fn();
const setCachedMock = vi.fn();
vi.mock('../xtreamSeriesCache', () => ({
  getCachedXtreamSeries: (id: number) => getCachedMock(id),
  setCachedXtreamSeries: (id: number, data: unknown) => setCachedMock(id, data),
}));

import { XtreamApiService } from '../xtreamApi';

const host = 'http://provider.example:8080';

describe('XtreamApiService : identifiants avec caractères spéciaux', () => {
  beforeEach(() => {
    iptvFetchMock.mockReset();
  });

  it('encode utilisateur et mot de passe dans les requêtes player_api', async () => {
    iptvFetchMock.mockResolvedValue('[]');
    const api = new XtreamApiService({ host, username: 'jean dupont', password: 'a&b#c+d?e/f' });
    await api.getLiveStreams();

    const url = new URL(iptvFetchMock.mock.calls[0][0]);
    // Relu par le serveur exactement comme saisi
    expect(url.searchParams.get('username')).toBe('jean dupont');
    expect(url.searchParams.get('password')).toBe('a&b#c+d?e/f');
    expect(url.searchParams.get('action')).toBe('get_live_streams');
  });

  it('garde les segments du chemin de flux intacts', () => {
    const api = new XtreamApiService({ host, username: 'jean', password: 'a/b?c#d' });
    const url = new URL(api.getStreamUrl('live', 42, 'ts'));
    const segments = url.pathname.split('/');
    expect(segments).toHaveLength(5);
    expect(segments[1]).toBe('live');
    expect(decodeURIComponent(segments[3])).toBe('a/b?c#d');
    expect(segments[4]).toBe('42.ts');
    expect(url.hash).toBe('');
    expect(url.search).toBe('');
  });

  it('extension du fournisseur hors liste : extension par défaut, chemin inchangé', () => {
    const api = new XtreamApiService({ host, username: 'jean', password: 'p' });
    expect(api.getStreamUrl('movie', 7, 'mkv/../x')).toBe(`${host}/movie/jean/p/7.mp4`);
    expect(api.getStreamUrl('live', 3, 'ts?a=b')).toBe(`${host}/live/jean/p/3.ts`);
    expect(api.getStreamUrl('series', 9, 'm3u8')).toBe(`${host}/series/jean/p/9.m3u8`);
  });

  it('adresse de flux inchangée pour un identifiant ordinaire', () => {
    const api = new XtreamApiService({ host, username: 'jean.dupont', password: 'S3cr3t!' });
    expect(api.getStreamUrl('movie', 7, 'mkv')).toBe(`${host}/movie/jean.dupont/S3cr3t!/7.mkv`);
  });
});

describe('XtreamApiService.getSeriesInfo : cache', () => {
  beforeEach(() => {
    iptvFetchMock.mockReset();
    getCachedMock.mockReset().mockResolvedValue(null);
    setCachedMock.mockReset().mockResolvedValue(undefined);
  });

  it("ne garde pas en cache une réponse sans épisodes", async () => {
    iptvFetchMock.mockResolvedValue(JSON.stringify({ info: { name: 'Série' }, episodes: {} }));
    const api = new XtreamApiService({ host, username: 'jean', password: 'x' });
    const info = await api.getSeriesInfo(12);
    expect(info?.info?.name).toBe('Série');
    expect(setCachedMock).not.toHaveBeenCalled();
  });

  it('ne garde pas en cache une réponse avec des saisons vides', async () => {
    iptvFetchMock.mockResolvedValue(JSON.stringify({ episodes: { '1': [] } }));
    const api = new XtreamApiService({ host, username: 'jean', password: 'x' });
    await api.getSeriesInfo(12);
    expect(setCachedMock).not.toHaveBeenCalled();
  });

  it('garde en cache une réponse avec des épisodes', async () => {
    const body = { episodes: { '1': [{ id: '100', episode_num: 1, title: 'Pilote' }] } };
    iptvFetchMock.mockResolvedValue(JSON.stringify(body));
    const api = new XtreamApiService({ host, username: 'jean', password: 'x' });
    await api.getSeriesInfo(12);
    expect(setCachedMock).toHaveBeenCalledWith(12, body);
  });
});
