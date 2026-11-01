/**
 * Tests pour GlobalSearchPage.tsx — recherche globale.
 * Vérifie : champ de recherche, états de départ / sans résultat, rangées films / séries / chaînes,
 * navigation vers les fiches, lecture d'une chaîne, favoris TV, plateforme TV.
 * Le moteur de recherche (useGlobalSearch) est simulé ; les rangées de cartes sont des relevés.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import type { LightIndexes, LightLive, LightMovie, LightSeries } from '../../types/lightIndex';
import type { CarouselItem } from '../../components/Lists/ContentCarousel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; query?: string }) =>
      opts?.query !== undefined ? `${key}:${opts.query}` : opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));
vi.mock('../GlobalSearchPage.css', () => ({}));

const search = vi.hoisted(() => ({
  value: { results: { movies: [], series: [], live: [] }, debouncedQuery: '' } as {
    results: { movies: unknown[]; series: unknown[]; live: unknown[] };
    debouncedQuery: string;
  },
}));
vi.mock('../../hooks/useGlobalSearch', () => ({ useGlobalSearch: () => search.value }));

const play = vi.fn();
vi.mock('../../contexts/PlayerContext', () => ({ usePlayer: () => ({ play }) }));
vi.mock('../../contexts/DevOverrideContext', () => ({
  useDevOverrides: () => ({
    overrides: { globalSearchPage: { forceNoResults: false, forceManyResults: null, forceError: null } },
    setActivePage: vi.fn(),
  }),
}));

const favorites = vi.hoisted(() => ({ set: new Set<number>() }));
vi.mock('../../services/liveTvBookmarksService', () => ({
  getFavorites: () => favorites.set,
  toggleFavorite: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../components/Lists/ContentCarousel', () => ({
  default: ({ title, items }: { title: string; items: CarouselItem[] }) => (
    <section data-testid={`rangee-${title}`}>
      {items.map((i) => (
        <button key={i.id} data-testid="carte" data-sources={i.overlayText ?? ''} data-image={i.image} data-type={i.mediaType} onClick={i.onClick}>
          {i.title}
        </button>
      ))}
    </section>
  ),
}));
vi.mock('../../components/Tv/ChannelCard', () => ({
  default: ({ channelName, isFavorite, onToggleFavorite }: { channelName: string; isFavorite: boolean; onToggleFavorite: (e?: React.MouseEvent) => void }) => (
    <div>
      <span>{channelName}</span>
      <button data-testid="favori" aria-pressed={isFavorite} onClick={onToggleFavorite}>favori</button>
    </div>
  ),
}));

import GlobalSearchPage from '../GlobalSearchPage';
import { toggleFavorite } from '../../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../../services/eventConstants';
import { setTvMode } from '../../utils/platform';

const indexes = { iconPrefixes: ['http://exemple.test/'] } as unknown as LightIndexes;

const movie = (id: number, name: string): LightMovie =>
  ({ id, name, tmdbId: id * 10, iconPrefixId: 0, iconSuffix: `${id}.jpg`, categoryId: '1', added: 0, containerExt: 'mkv' }) as LightMovie;
const serie = (id: number, name: string): LightSeries =>
  ({ id, name, tmdbId: id * 10, iconPrefixId: 0, iconSuffix: `${id}.jpg`, categoryId: '1', added: 0 }) as unknown as LightSeries;
const live = (id: number, name: string): LightLive =>
  ({ id, name, categoryId: '5', iconPrefixId: 0, iconSuffix: `${id}.png`, epgChannelId: 'epg1' }) as unknown as LightLive;

function setResults(r: { movies?: unknown[]; series?: unknown[]; live?: unknown[] }, debouncedQuery = 'test') {
  search.value = { results: { movies: [], series: [], live: [], ...r }, debouncedQuery };
}

function setup(searchQuery = 'test') {
  const props = { onNavigateToContent: vi.fn(), onSearchChange: vi.fn(), searchQuery, lightIndexes: indexes };
  render(<GlobalSearchPage {...props} />);
  return props;
}

describe('GlobalSearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    favorites.set = new Set();
    setResults({}, '');
  });

  afterEach(() => {
    setTvMode(false);
  });

  describe('Champ de recherche', () => {
    it('reçoit le focus à l\'ouverture et affiche la saisie courante', () => {
      setup('matrix');
      const champ = screen.getByTestId('search-input');
      expect(champ).toHaveFocus();
      expect(champ).toHaveValue('matrix');
    });

    it('signale chaque modification de la saisie', () => {
      const props = setup('');
      fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'dune' } });
      expect(props.onSearchChange).toHaveBeenCalledWith('dune');
    });

    it('referme le clavier avec Entrée', () => {
      setup('');
      const champ = screen.getByTestId('search-input');
      fireEvent.keyDown(champ, { key: 'Enter' });
      expect(champ).not.toHaveFocus();
    });

    it('laisse le champ éditable sur le bureau', () => {
      setup('');
      expect(screen.getByTestId('search-input')).not.toHaveAttribute('readonly');
    });

    it('rend le champ non éditable d\'office sur Android TV, pour que seul OK ouvre le clavier', () => {
      setTvMode(true);
      setup('');
      expect(screen.getByTestId('search-input')).toHaveAttribute('readonly');
    });
  });

  describe('États sans résultat', () => {
    it('invite à écrire quand rien n\'est saisi', () => {
      setup('');
      expect(screen.getByTestId('search-start')).toHaveTextContent('start_typing');
    });

    it('annonce l\'absence de résultat avec le texte cherché', () => {
      setResults({}, 'xyz');
      setup('xyz');
      expect(screen.getByTestId('search-no-results')).toHaveTextContent('no_results:xyz');
      expect(screen.queryByTestId('search-start')).not.toBeInTheDocument();
    });
  });

  describe('Résultats', () => {
    it('affiche une rangée de films avec le nombre de sources et l\'affiche', () => {
      setResults({
        movies: [
          { representative: movie(1, 'Film Un'), sourceCount: 3 },
          { representative: movie(2, 'Film Deux'), sourceCount: 1 },
        ],
      });
      setup();
      const rangee = screen.getByTestId('rangee-movies_title:2');
      const cartes = within(rangee).getAllByTestId('carte');
      expect(cartes[0]).toHaveAttribute('data-sources', '3 sources');
      expect(cartes[0]).toHaveAttribute('data-image', 'http://exemple.test/1.jpg');
      expect(cartes[1]).toHaveAttribute('data-sources', '');
    });

    it('ouvre la fiche du film choisi', () => {
      setResults({ movies: [{ representative: movie(1, 'Film Un'), sourceCount: 1 }] });
      const props = setup();
      fireEvent.click(screen.getByText('Film Un'));
      expect(props.onNavigateToContent).toHaveBeenCalledWith('movie', { tmdbId: 10, streamId: 1 });
    });

    it('ouvre la fiche de la série choisie', () => {
      setResults({ series: [{ representative: serie(4, 'Serie Quatre'), sourceCount: 2 }] });
      const props = setup();
      expect(screen.getByTestId('rangee-series_title:1')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Serie Quatre'));
      expect(props.onNavigateToContent).toHaveBeenCalledWith('series', { tmdbId: 40, seriesId: 4 });
    });

    it('n\'affiche que les rangées qui ont des résultats', () => {
      setResults({ series: [{ representative: serie(4, 'Serie Quatre'), sourceCount: 1 }] });
      setup();
      expect(screen.queryByTestId('rangee-movies_title:0')).not.toBeInTheDocument();
      expect(screen.queryByTestId('search-tv-track')).not.toBeInTheDocument();
    });
  });

  describe('Chaînes TV', () => {
    it('lance la chaîne choisie en direct', () => {
      setResults({ live: [live(7, 'Chaine Sept')] });
      setup();
      fireEvent.click(screen.getByTestId('search-tv-card'));
      expect(play).toHaveBeenCalledWith(expect.objectContaining({
        stream_id: 7,
        name: 'Chaine Sept',
        stream_type: 'live',
        stream_icon: 'http://exemple.test/7.png',
        category_id: '5',
        epg_channel_id: 'epg1',
      }));
    });

    it('affiche l\'état favori des chaînes', () => {
      favorites.set = new Set([7]);
      setResults({ live: [live(7, 'Chaine Sept'), live(8, 'Chaine Huit')] });
      setup();
      const favoris = screen.getAllByTestId('favori');
      expect(favoris[0]).toHaveAttribute('aria-pressed', 'true');
      expect(favoris[1]).toHaveAttribute('aria-pressed', 'false');
    });

    it('bascule un favori sans lancer la chaîne', () => {
      setResults({ live: [live(7, 'Chaine Sept')] });
      setup();
      fireEvent.click(screen.getByTestId('favori'));
      expect(toggleFavorite).toHaveBeenCalledWith(7);
      expect(play).not.toHaveBeenCalled();
    });

    it('relit les favoris quand ils changent ailleurs', () => {
      setResults({ live: [live(7, 'Chaine Sept')] });
      setup();
      expect(screen.getByTestId('favori')).toHaveAttribute('aria-pressed', 'false');
      favorites.set = new Set([7]);
      act(() => {
        window.dispatchEvent(new Event(LIVE_TV_BOOKMARKS_EVENT));
      });
      expect(screen.getByTestId('favori')).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
