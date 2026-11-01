/**
 * « Reprendre » : un clic lance directement le numéro enregistré, sauf si le fournisseur l'a donné à
 * un autre titre.
 *
 * La rangée est rendue pour de vrai ; seule la liste virtuelle est remplacée par un relevé des
 * cartes, pour appeler leur clic comme le ferait l'écran.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { CarouselItem } from '../../Lists/ContentCarousel';

let shownItems: CarouselItem[] = [];
vi.mock('../VirtualDashboardRow', () => ({
  default: (props: { items: CarouselItem[] }) => {
    shownItems = props.items;
    return null;
  },
}));
vi.mock('../../../services/detailFetcher', () => ({ getMovieDetail: vi.fn(async () => null) }));
vi.mock('../../../services/storage', () => ({ StorageService: { getCredentials: vi.fn(async () => null) } }));
vi.mock('../../../services/xtreamApi', () => ({ XtreamApiService: vi.fn() }));
vi.mock('../../../services/xtreamSeriesCache', () => ({ getCachedXtreamSeries: vi.fn(async () => null) }));

import ContinueWatchingRow from '../ContinueWatchingRow';
import type { PlaybackProgressItem } from '../../../services/smartContinue';
import type { LightIndexes, LightMovie, LightSeries } from '../../../types/lightIndex';

const movie = (id: number, tmdbId: number, name: string): LightMovie => ({
  id, name, tmdbId, iconPrefixId: 0, iconSuffix: '', categoryId: '1', added: 0, containerExt: 'mkv',
});

function catalog(...movies: LightMovie[]): LightIndexes {
  return {
    movies: new Map(movies.map((m) => [m.id, m])),
    series: new Map(),
    live: new Map(),
    categories: new Map(),
    moviesByTmdb: new Map(movies.filter((m) => m.tmdbId > 0).map((m) => [m.tmdbId, m])),
    seriesByTmdb: new Map(),
    iconPrefixes: [''],
  };
}

/** Reprise du film TMDB 1, enregistrée sous le numéro 100 du fournisseur, à 20 min */
const resume: PlaybackProgressItem = {
  id: 100, type: 'movie', title: 'Le Film', image: 'poster.jpg', progress: 40, lastWatched: 1,
  tmdbId: 1, timeSeconds: 1200, containerExtension: 'mkv',
};

/** Laisse finir le lancement asynchrone déclenché par le clic */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const play = vi.fn(async () => {});
const navigateById = vi.fn();
const onUnavailable = vi.fn();

function showResume(indexes: LightIndexes, item: PlaybackProgressItem = resume): CarouselItem {
  render(
    <ContinueWatchingRow
      items={[item]}
      lightIndexes={indexes}
      play={play}
      setCurrentSeries={vi.fn()}
      navigateById={navigateById}
      handleWatchlistToggle={vi.fn(async () => {})}
      onUnavailable={onUnavailable}
    />,
  );
  return shownItems[0];
}

function clickResume(indexes: LightIndexes, item?: PlaybackProgressItem) {
  showResume(indexes, item).onClick?.();
}

const series = (id: number, tmdbId: number, name: string): LightSeries => ({
  id, name, tmdbId, iconPrefixId: 0, iconSuffix: '', categoryId: '1', added: 0,
});

function seriesCatalog(...list: LightSeries[]): LightIndexes {
  return {
    ...catalog(),
    series: new Map(list.map((s) => [s.id, s])),
    seriesByTmdb: new Map(list.filter((s) => s.tmdbId > 0).map((s) => [s.tmdbId, s])),
  };
}

/** Reprise de l'épisode 5001 de la série TMDB 7, rangée sous le numéro de série 300 */
const episodeResume: PlaybackProgressItem = {
  id: 5001, type: 'series', title: 'La Série', image: 'serie.jpg', progress: 30, lastWatched: 1,
  tmdbId: 7, timeSeconds: 600, containerExtension: 'mp4', seriesId: 300,
  episodeInfo: { seasonNumber: 1, episodeNumber: 2, episodeId: '5001' },
};

describe('ContinueWatchingRow — reprise d\'un film', () => {
  beforeEach(() => {
    shownItems = [];
    play.mockClear();
    navigateById.mockClear();
    onUnavailable.mockClear();
  });

  it('lance le film enregistré à sa position quand le numéro mène toujours à ce film', async () => {
    clickResume(catalog(movie(100, 1, 'Le Film')));

    await flush();
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ stream_id: 100 }), undefined, 1200, { tmdbId: 1 });
  });

  // Le fournisseur a réattribué le numéro 100 à un autre film (TMDB 2). La carte garde
  // l'ancien titre (copie enregistrée) ; avant la correction, le clic lançait l'autre film à
  // l'ancienne position.
  it('Numéro réattribué à un autre film : ne lance jamais ce film', async () => {
    clickResume(catalog(movie(100, 2, 'Un Autre Film')));

    await flush(); // laisse partir la lecture (asynchrone) si elle doit partir
    expect(play).not.toHaveBeenCalled();
  });

  it('Numéro réattribué et film absent du catalogue : carte « Introuvable », le clic ouvre sa fenêtre Rechercher / Retirer', async () => {
    const card = showResume(catalog(movie(100, 2, 'Un Autre Film')));

    expect(card.unavailable).toBe(true);
    expect(card.showPlayButton).toBe(false);
    expect(card.onAddToList).toBeUndefined(); // son numéro est celui d'un autre film
    card.onClick?.();
    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(navigateById).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(resume);
  });

  it('Le film est au catalogue sous un autre numéro : il est lancé à ce numéro, à sa position', async () => {
    const card = showResume(catalog(movie(100, 2, 'Un Autre Film'), { ...movie(250, 1, 'Le Film'), containerExt: 'mp4' }));

    expect(card.unavailable).toBe(false);
    card.onClick?.();
    await flush();
    expect(play).toHaveBeenCalledTimes(1);
    // Le numéro TMDB part dans les options : c'est lui qu'enregistre la reprise au nouveau numéro
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ stream_id: 250, container_extension: 'mp4' }), undefined, 1200, { tmdbId: 1 });
  });

  it('Ancien numéro disparu, film retrouvé ailleurs : lancé au nouveau numéro', async () => {
    clickResume(catalog(movie(250, 1, 'Le Film')));

    await flush();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ stream_id: 250 }), undefined, 1200, { tmdbId: 1 });
  });

  it('un numéro du catalogue sans TMDB reste lancé comme avant (rien à comparer)', async () => {
    clickResume(catalog(movie(100, 0, 'Le Film')));

    await flush();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ stream_id: 100 }), undefined, 1200, { tmdbId: 1 });
  });
});

describe('ContinueWatchingRow — reprise d\'un épisode', () => {
  beforeEach(() => {
    shownItems = [];
    play.mockClear();
    navigateById.mockClear();
    onUnavailable.mockClear();
  });

  it('lance l\'épisode enregistré quand le numéro de série mène toujours à cette série', async () => {
    clickResume(seriesCatalog(series(300, 7, 'La Série')), episodeResume);

    await flush();
    expect(play).toHaveBeenCalledWith(expect.objectContaining({ id: '5001' }), undefined, 600, expect.objectContaining({ seriesId: 300 }));
  });

  it('numéro de série réattribué à une autre série : aucun épisode lancé, carte « Introuvable »', async () => {
    const card = showResume(seriesCatalog(series(300, 8, 'Une Autre Série')), episodeResume);

    expect(card.unavailable).toBe(true);
    card.onClick?.();
    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledWith(episodeResume);
  });

  it('série retrouvée sous un autre numéro : sa fiche s\'ouvre, aucun épisode de l\'ancien numéro lancé', async () => {
    clickResume(seriesCatalog(series(300, 8, 'Une Autre Série'), series(410, 7, 'La Série')), episodeResume);

    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(navigateById).toHaveBeenCalledWith('series', 410, 7);
  });
});

describe('ContinueWatchingRow — carte « Introuvable » à retirer', () => {
  beforeEach(() => {
    shownItems = [];
    onUnavailable.mockClear();
  });

  // La carte n'avait que la recherche ; elle s'ouvre maintenant sur la fenêtre qui propose
  // aussi « Retirer », au clic, au toucher et au bouton OK de la télécommande (même action)
  it('film disparu du catalogue : le clic ouvre la fenêtre avec cette reprise', () => {
    const card = showResume(catalog(movie(200, 3, 'Autre')));

    expect(card.unavailable).toBe(true);
    card.onClick?.();
    expect(onUnavailable).toHaveBeenCalledWith(resume);
  });

  // Le bouton Ma liste et l'appui long de la télécommande agiraient sur le numéro d'un autre titre
  it('aucun bouton Ma liste ni appui long sur la carte : son numéro est celui d\'un autre titre', () => {
    const card = showResume(catalog(movie(100, 2, 'Un Autre Film')));

    expect(card.tmdbId).toBeUndefined();
    expect(card.streamId).toBeUndefined();
    expect(card.onAddToList).toBeUndefined();
  });

  it('une carte lançable garde son bouton Ma liste', () => {
    const card = showResume(catalog(movie(100, 1, 'Le Film')));

    expect(card.tmdbId).toBe(1);
    expect(card.streamId).toBe(100);
    card.onClick?.();
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
