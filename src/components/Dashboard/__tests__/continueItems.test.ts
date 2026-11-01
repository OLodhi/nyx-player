/**
 * continueItems : cartes de la rangée « Reprendre » (badges, affiche, cartes « Introuvable »,
 * lecture directe d'un film ou d'un épisode, ouverture de fiche).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  getMovieDetail: vi.fn(),
  getCredentials: vi.fn(),
  getSeriesInfo: vi.fn(),
  getCachedXtreamSeries: vi.fn(),
}));

vi.mock('../../../services/detailFetcher', () => ({ getMovieDetail: h.getMovieDetail }));
vi.mock('../../../services/storage', () => ({ StorageService: { getCredentials: h.getCredentials } }));
vi.mock('../../../services/xtreamApi', () => ({
  XtreamApiService: class { getSeriesInfo = h.getSeriesInfo; },
}));
vi.mock('../../../services/xtreamSeriesCache', () => ({ getCachedXtreamSeries: h.getCachedXtreamSeries }));
vi.mock('../../../utils/devLog', () => ({ devLog: vi.fn() }));

import { buildContinueItems, type ContinueActions } from '../continueItems';
import type { PlaybackProgressItem } from '../../../services/playbackProgressService';
import type { LightIndexes, LightMovie, LightSeries } from '../../../types/lightIndex';

const labels = { unavailable: 'Introuvable' };

function makeActions(): ContinueActions {
  return {
    play: vi.fn(async () => {}),
    setCurrentSeries: vi.fn(),
    navigateById: vi.fn(),
    handleWatchlistToggle: vi.fn(async () => {}),
    onUnavailable: vi.fn(),
  };
}

function movie(id: number, tmdbId: number, extra: Partial<LightMovie> = {}): LightMovie {
  return { id, name: `Film ${id}`, iconPrefixId: 0, iconSuffix: 'a.jpg', tmdbId, categoryId: '1', added: 0, containerExt: 'mkv', ...extra };
}
function serie(id: number, tmdbId: number, extra: Partial<LightSeries> = {}): LightSeries {
  return { id, name: `Série ${id}`, iconPrefixId: 0, iconSuffix: 's.jpg', tmdbId, categoryId: '1', added: 0, ...extra };
}
function indexes(movies: LightMovie[] = [], series: LightSeries[] = []): LightIndexes {
  return {
    movies: new Map(movies.map((m) => [m.id, m])),
    series: new Map(series.map((s) => [s.id, s])),
    live: new Map(),
    categories: new Map(),
    moviesByTmdb: new Map(movies.filter((m) => m.tmdbId > 0).map((m) => [m.tmdbId, m])),
    seriesByTmdb: new Map(series.filter((s) => s.tmdbId > 0).map((s) => [s.tmdbId, s])),
    iconPrefixes: ['http://exemple.test/img/'],
  };
}

function item(over: Partial<PlaybackProgressItem> = {}): PlaybackProgressItem {
  return {
    id: 10, type: 'movie', title: 'Mon film', image: 'http://exemple.test/p.jpg', progress: 40,
    lastWatched: 1, tmdbId: 500, timeSeconds: 120, containerExtension: 'mp4', ...over,
  };
}

function build(items: PlaybackProgressItem[], idx: LightIndexes | undefined, actions = makeActions()) {
  return { cards: buildContinueItems(items, idx, actions, labels), actions };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getMovieDetail.mockResolvedValue(null);
  h.getCredentials.mockResolvedValue(null);
  h.getCachedXtreamSeries.mockResolvedValue(null);
});

describe('buildContinueItems - champs de la carte', () => {
  it('renvoie une liste vide pour aucune reprise', () => {
    expect(build([], undefined).cards).toEqual([]);
  });

  it('reprend titre, progression, type, affiche et identifiants d\'un film', () => {
    const { cards } = build([item()], undefined);
    expect(cards[0]).toMatchObject({
      id: 10, title: 'Mon film', image: 'http://exemple.test/p.jpg', progress: 40, mediaType: 'movie',
      tmdbId: 500, streamId: 10, unavailable: false, showPlayButton: true, overlayText: undefined,
    });
  });

  it.each([
    [{ seasonNumber: 2, episodeNumber: 5, episodeId: '9' }, 'S2E5'],
    [{ seasonNumber: 0, episodeNumber: 3, episodeId: '9' }, 'E3'],
    [{ seasonNumber: 1, episodeNumber: 4, episodeId: '9', isNextEpisode: true }, '▶ S1E4'],
  ])('badge d\'épisode %j -> "%s"', (episodeInfo, badge) => {
    const { cards } = build([item({ type: 'series', seriesId: 7, episodeInfo })], undefined);
    expect(cards[0].overlayText).toBe(badge);
    expect(cards[0].streamId).toBe(7); // une série pointe sur son series_id
  });

  it('retombe sur l\'affiche du catalogue quand l\'image enregistrée est vide', () => {
    const idx = indexes([movie(10, 500)]);
    const { cards } = build([item({ image: '' })], idx);
    expect(cards[0].image).toBe('http://exemple.test/img/a.jpg');
  });

  it('retombe sur l\'affiche de la série du catalogue', () => {
    const idx = indexes([], [serie(7, 800)]);
    const { cards } = build([item({ type: 'series', image: '', seriesId: 7, tmdbId: 800 })], idx);
    expect(cards[0].image).toBe('http://exemple.test/img/s.jpg');
  });

  it('laisse l\'image vide si le catalogue ne la connaît pas', () => {
    const { cards } = build([item({ image: '' })], undefined);
    expect(cards[0].image).toBe('');
  });
});

describe('buildContinueItems - cartes « Introuvable »', () => {
  // Le numéro 10 désigne maintenant un autre titre (TMDB 999) et le vrai titre (500) n'existe plus
  const idx = indexes([movie(10, 999)]);

  it('marque la carte, retire ses boutons et son affiche', () => {
    const { cards } = build([item({ image: '' })], idx);
    expect(cards[0]).toMatchObject({
      unavailable: true, showPlayButton: false, overlayText: 'Introuvable',
      tmdbId: undefined, streamId: undefined, onAddToList: undefined, image: '',
    });
  });

  it('refuse la lecture et ouvre la fenêtre de retrait', () => {
    const it0 = item();
    const { cards, actions } = build([it0], idx);
    cards[0].onClick?.();
    expect(actions.onUnavailable).toHaveBeenCalledWith(it0);
    expect(actions.play).not.toHaveBeenCalled();
    expect(actions.navigateById).not.toHaveBeenCalled();
  });

  it('ne plante pas sans rappel onUnavailable', () => {
    const actions = makeActions();
    delete actions.onUnavailable;
    const { cards } = build([item()], idx, actions);
    expect(() => cards[0].onClick?.()).not.toThrow();
  });
});

describe('buildContinueItems - ajout à Ma liste', () => {
  it('bascule le film avec son numéro de flux et son TMDB', () => {
    const { cards, actions } = build([item()], undefined);
    cards[0].onAddToList?.();
    expect(actions.handleWatchlistToggle).toHaveBeenCalledWith(10, 500, 'movie');
  });

  it('bascule la série avec son series_id', () => {
    const { cards, actions } = build([item({ type: 'series', seriesId: 7, tmdbId: 800 })], undefined);
    cards[0].onAddToList?.();
    expect(actions.handleWatchlistToggle).toHaveBeenCalledWith(7, 800, 'series');
  });

  it('utilise 0 quand le TMDB est inconnu', () => {
    const { cards, actions } = build([item({ tmdbId: null })], undefined);
    cards[0].onAddToList?.();
    expect(actions.handleWatchlistToggle).toHaveBeenCalledWith(10, 0, 'movie');
  });
});

describe('buildContinueItems - lecture d\'un film', () => {
  it('lance le film à sa position avec son extension et son TMDB', async () => {
    const { cards, actions } = build([item()], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(actions.play).toHaveBeenCalledWith(
      { stream_id: 10, name: 'Mon film', container_extension: 'mp4', tmdb: 500 },
      undefined, 120, { tmdbId: 500 }
    );
    expect(h.getMovieDetail).not.toHaveBeenCalled();
  });

  it('va chercher l\'extension en base quand elle manque', async () => {
    h.getMovieDetail.mockResolvedValueOnce({ container_extension: 'avi' });
    const { cards, actions } = build([item({ containerExtension: undefined })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(h.getMovieDetail).toHaveBeenCalledWith(10);
    expect(vi.mocked(actions.play).mock.calls[0][0]).toMatchObject({ container_extension: 'avi' });
  });

  it('lance quand même si la recherche de l\'extension échoue', async () => {
    h.getMovieDetail.mockRejectedValueOnce(new Error('SQL'));
    const { cards, actions } = build([item({ containerExtension: undefined })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(vi.mocked(actions.play).mock.calls[0][0]).toMatchObject({ container_extension: undefined });
  });

  it('film re-lié : lance le nouveau numéro avec l\'extension du catalogue', async () => {
    const idx = indexes([movie(55, 500, { containerExt: 'ts' }), movie(10, 999)]);
    // 10 appartient à un autre titre, 500 est maintenant au numéro 55
    const { cards, actions } = build([item({ containerExtension: 'mp4' })], idx);
    expect(cards[0].streamId).toBe(55);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(vi.mocked(actions.play).mock.calls[0][0]).toMatchObject({ stream_id: 55, container_extension: 'ts' });
    expect(vi.mocked(actions.play).mock.calls[0][3]).toEqual({ tmdbId: 500 });
  });

  it('ne transmet pas d\'options quand le TMDB est inconnu', async () => {
    const { cards, actions } = build([item({ tmdbId: null })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(vi.mocked(actions.play).mock.calls[0][3]).toBeUndefined();
  });
});

describe('buildContinueItems - lecture d\'un épisode', () => {
  const episode = (over: Partial<PlaybackProgressItem> = {}) => item({
    id: 321, type: 'series', seriesId: 7, tmdbId: 800, title: 'Ma série', timeSeconds: 600,
    containerExtension: 'mkv',
    episodeInfo: { seasonNumber: 1, episodeNumber: 2, episodeId: '322' }, ...over,
  });

  it('reprend l\'épisode en cours à sa position', async () => {
    const { cards, actions } = build([episode()], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(actions.play).toHaveBeenCalledWith(
      { id: '321', episode_num: 2, title: 'Ma série', container_extension: 'mkv', tmdb: 800 },
      undefined, 600,
      { seriesId: 7, tmdbId: 800, posterUrl: 'http://exemple.test/p.jpg' }
    );
  });

  it('épisode suivant : démarre à 0 avec l\'identifiant du suivant et son extension du cache', async () => {
    h.getCachedXtreamSeries.mockResolvedValueOnce({
      episodes: { 1: [{ id: '322', container_extension: 'mp4' }], 2: [{ id: '400' }] },
    });
    const { cards, actions } = build([episode({
      episodeInfo: { seasonNumber: 1, episodeNumber: 2, episodeId: '322', isNextEpisode: true },
    })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(h.getCachedXtreamSeries).toHaveBeenCalledWith(7);
    const [played, , seek] = vi.mocked(actions.play).mock.calls[0];
    expect(played).toMatchObject({ id: '322', container_extension: 'mp4' });
    expect(seek).toBe(0);
  });

  it('épisode suivant absent du cache : garde l\'extension enregistrée', async () => {
    h.getCachedXtreamSeries.mockResolvedValueOnce({ episodes: { 1: [{ id: '999' }] } });
    const { cards, actions } = build([episode({
      episodeInfo: { seasonNumber: 1, episodeNumber: 2, episodeId: '322', isNextEpisode: true },
    })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(vi.mocked(actions.play).mock.calls[0][0]).toMatchObject({ container_extension: 'mkv' });
  });

  it('épisode suivant : lance quand même si le cache échoue', async () => {
    h.getCachedXtreamSeries.mockRejectedValueOnce(new Error('SQL'));
    const { cards, actions } = build([episode({
      episodeInfo: { seasonNumber: 1, episodeNumber: 2, episodeId: '322', isNextEpisode: true },
    })], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
  });

  it('charge ensuite les infos de la série pour la navigation entre épisodes', async () => {
    h.getCredentials.mockResolvedValueOnce({ serverUrl: 'http://exemple.test', username: 'user', password: 'pass' });
    h.getSeriesInfo.mockResolvedValueOnce({ episodes: { 1: [] }, info: { name: 'x' } });
    const { cards, actions } = build([episode()], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.setCurrentSeries).toHaveBeenCalled());
    expect(h.getSeriesInfo).toHaveBeenCalledWith(7);
    expect(vi.mocked(actions.setCurrentSeries).mock.calls[0][0]).toMatchObject({
      series_id: 7, name: 'Ma série', tmdb: 800, episodes: { 1: [] },
    });
  });

  it('ne charge pas la série sans identifiants enregistrés', async () => {
    const { cards, actions } = build([episode()], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(h.getCredentials).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getSeriesInfo).not.toHaveBeenCalled();
    expect(actions.setCurrentSeries).not.toHaveBeenCalled();
  });

  it('ne fait pas échouer la lecture si le chargement de la série échoue', async () => {
    h.getCredentials.mockRejectedValueOnce(new Error('coffre fermé'));
    const { cards, actions } = build([episode()], undefined);
    cards[0].onClick?.();
    await vi.waitFor(() => expect(actions.play).toHaveBeenCalled());
    expect(actions.setCurrentSeries).not.toHaveBeenCalled();
  });

  it('série re-liée : ouvre la fiche au nouveau numéro sans lancer d\'épisode', () => {
    // 7 désigne un autre titre ; la série 800 est maintenant au numéro 70
    const idx = indexes([], [serie(7, 111), serie(70, 800)]);
    const { cards, actions } = build([episode()], idx);
    cards[0].onClick?.();
    expect(actions.navigateById).toHaveBeenCalledWith('series', 70, 800);
    expect(actions.play).not.toHaveBeenCalled();
  });
});

describe('buildContinueItems - ouverture de fiche (sans lecture directe)', () => {
  it('série sans info d\'épisode : ouvre la fiche', () => {
    const { cards, actions } = build([item({ type: 'series', seriesId: 7, tmdbId: 800 })], undefined);
    cards[0].onClick?.();
    expect(actions.navigateById).toHaveBeenCalledWith('series', 7, 800);
  });

  it('série sans info d\'épisode ni TMDB : ouvre la fiche sans TMDB', () => {
    const { cards, actions } = build([item({ type: 'series', seriesId: 7, tmdbId: null })], undefined);
    cards[0].onClick?.();
    expect(actions.navigateById).toHaveBeenCalledWith('series', 7, undefined);
  });

  it('série sans seriesId : ne navigue nulle part', () => {
    const { cards, actions } = build([item({ type: 'series', seriesId: undefined })], undefined);
    cards[0].onClick?.();
    expect(actions.navigateById).not.toHaveBeenCalled();
    expect(actions.play).not.toHaveBeenCalled();
  });
});
