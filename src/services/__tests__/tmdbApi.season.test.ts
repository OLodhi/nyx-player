/**
 * Saisons d'une série : `getSeasonDetailsWithFallback` lit d'abord le
 * cache, puis TMDB en français, et comble les résumés manquants avec l'anglais.
 *
 * Aucun appel réseau : le proxy TMDB est remplacé par un faux `fetch` qui répond selon la langue
 * demandée. Le vrai client (`tmdbFetch`, limiteur de débit compris) est utilisé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TmdbSeasonDetails } from '../../types/tmdb';

let appLanguage: 'fr-FR' | 'en-US' = 'fr-FR';
vi.mock('../../utils/tmdbLanguage', () => ({ getTmdbLanguage: () => appLanguage }));
vi.mock('../supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jeton-de-test' } } })) } },
}));
const getCachedDetails = vi.fn(async (): Promise<unknown> => null);
const cacheSeasonDetails = vi.fn(async () => {});
vi.mock('../tmdbCacheSqlite', () => ({
  getCachedDetails: (...args: unknown[]) => getCachedDetails(...(args as [])),
  cacheSeasonDetails: (...args: unknown[]) => cacheSeasonDetails(...(args as [])),
}));

import tmdb from '../tmdbApi';

const episode = (episode_number: number, overview: string, name = `Épisode ${episode_number}`) => ({ episode_number, name, overview });
const season = (...episodes: ReturnType<typeof episode>[]) => ({ id: 1, season_number: 1, episodes }) as unknown as TmdbSeasonDetails;

/** Réponses du faux proxy, par langue ; `null` = erreur 404 */
let answers: Record<string, TmdbSeasonDetails | null> = {};
const fetchMock = vi.fn(async (url: string) => {
  const language = new URL(url).searchParams.get('language') ?? '';
  const body = answers[language];
  if (!body) return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
  return { ok: true, status: 200, statusText: 'OK', json: async () => structuredClone(body) };
});
const languagesAsked = () => fetchMock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('language'));
const overviews = (data: TmdbSeasonDetails) => data.episodes.map((ep) => ep.overview);

describe('tmdb.getSeasonDetailsWithFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appLanguage = 'fr-FR';
    answers = {};
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saison déjà en cache : aucun appel réseau', async () => {
    const cached = season(episode(1, 'En cache'));
    getCachedDetails.mockResolvedValueOnce(cached);

    await expect(tmdb.getSeasonDetailsWithFallback(10, 1)).resolves.toBe(cached);
    expect(getCachedDetails).toHaveBeenCalledWith(10, 'season', 1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('français complet : un seul appel, en fr-FR, mis en cache', async () => {
    answers = { 'fr-FR': season(episode(1, 'Résumé 1'), episode(2, 'Résumé 2')) };

    const data = await tmdb.getSeasonDetailsWithFallback(10, 1);

    expect(overviews(data)).toEqual(['Résumé 1', 'Résumé 2']);
    expect(languagesAsked()).toEqual(['fr-FR']);
    expect(cacheSeasonDetails).toHaveBeenCalledTimes(1);
    expect(cacheSeasonDetails).toHaveBeenCalledWith(10, 1, data);
  });

  it('résumés français manquants : comblés épisode par épisode avec l\'anglais, une seule écriture en cache', async () => {
    answers = {
      'fr-FR': season(episode(1, 'Résumé 1'), episode(2, ''), episode(3, '  ')),
      'en-US': season(episode(1, 'Summary 1', 'Episode 1'), episode(2, 'Summary 2', 'Episode 2'), episode(3, 'Summary 3', 'Episode 3')),
    };

    const data = await tmdb.getSeasonDetailsWithFallback(10, 1);

    expect(overviews(data)).toEqual(['Résumé 1', 'Summary 2', 'Summary 3']);
    expect(data.episodes.map((ep) => ep.name)).toEqual(['Épisode 1', 'Épisode 2', 'Épisode 3']);
    expect(languagesAsked()).toEqual(['fr-FR', 'en-US']);
    expect(cacheSeasonDetails).toHaveBeenCalledTimes(1);
    expect(cacheSeasonDetails).toHaveBeenCalledWith(10, 1, data);
  });

  it('anglais en échec pour les résumés manquants : le français est gardé et mis en cache', async () => {
    answers = { 'fr-FR': season(episode(1, 'Résumé 1'), episode(2, '')) };

    const data = await tmdb.getSeasonDetailsWithFallback(10, 1);

    expect(overviews(data)).toEqual(['Résumé 1', '']);
    expect(cacheSeasonDetails).toHaveBeenCalledWith(10, 1, data);
  });

  it('saison absente en français (404) : l\'anglais complet la remplace', async () => {
    answers = { 'en-US': season(episode(1, 'Summary 1')) };

    const data = await tmdb.getSeasonDetailsWithFallback(10, 1);

    expect(overviews(data)).toEqual(['Summary 1']);
    expect(languagesAsked()).toEqual(['fr-FR', 'en-US']);
    expect(cacheSeasonDetails).toHaveBeenCalledWith(10, 1, data);
  });

  it('français et anglais en échec : l\'erreur remonte et rien n\'est mis en cache', async () => {
    await expect(tmdb.getSeasonDetailsWithFallback(10, 1)).rejects.toThrow(/404/);
    expect(cacheSeasonDetails).not.toHaveBeenCalled();
  });

  it('application en anglais : un seul appel, en en-US', async () => {
    appLanguage = 'en-US';
    answers = { 'en-US': season(episode(1, '')) };

    const data = await tmdb.getSeasonDetailsWithFallback(10, 1);

    expect(overviews(data)).toEqual(['']);
    expect(languagesAsked()).toEqual(['en-US']);
    expect(cacheSeasonDetails).toHaveBeenCalledTimes(1);
  });
});
