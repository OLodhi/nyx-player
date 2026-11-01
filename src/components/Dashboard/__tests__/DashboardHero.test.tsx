/**
 * Tests pour DashboardHero.tsx — bannière de l'accueil.
 * Vérifie : film affiché, lecture avec choix de la source par langue, repli sur la fiche, Ma liste,
 * forçages du DevPanel. La bannière et la rotation sont remplacées par des relevés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { HeroMovie } from '../../../types/dashboard';
import type { LightIndexes } from '../../../types/lightIndex';

const rotation = {
  heroIndex: 0,
  isFading: false,
  handleDotClick: vi.fn(),
  setHeld: vi.fn(),
};
const useHeroRotation = vi.fn((_movies: HeroMovie[], _paused?: boolean) => rotation);
vi.mock('../../../hooks/useHeroRotation', () => ({
  useHeroRotation: (movies: HeroMovie[], paused?: boolean) => useHeroRotation(movies, paused),
}));

vi.mock('../HeroBanner', () => ({
  default: (p: {
    movie: HeroMovie | null; loading: boolean; isFading: boolean; totalSlides: number; currentIndex: number;
    onPlay: () => void; onInfo: () => void; onToggleWatchlist: () => void;
  }) => (
    <div data-testid="banniere" data-loading={String(p.loading)} data-fading={String(p.isFading)} data-total={p.totalSlides} data-index={p.currentIndex}>
      <span data-testid="titre">{p.movie?.title ?? ''}</span>
      <span data-testid="logo">{p.movie?.logoUrl ?? ''}</span>
      <button onClick={p.onPlay}>lecture</button>
      <button onClick={p.onInfo}>infos</button>
      <button onClick={p.onToggleWatchlist}>maliste</button>
    </div>
  ),
}));

vi.mock('../../../services/detailFetcher', () => ({ getMovieDetail: vi.fn() }));
vi.mock('../../../utils/lightIndexHelpers', () => ({ getAllVersionsByTmdb: vi.fn() }));
vi.mock('../../../utils/tmdbLanguage', () => ({ getAppLanguage: vi.fn(() => 'fr') }));

import DashboardHero from '../DashboardHero';
import { getMovieDetail } from '../../../services/detailFetcher';
import { getAllVersionsByTmdb } from '../../../utils/lightIndexHelpers';

const heroes: HeroMovie[] = [
  { id: 10, tmdbId: 500, title: 'Film A', overview: '', backdropUrl: 'http://exemple.test/a.jpg', logoUrl: 'http://exemple.test/a-logo.png' },
  { id: 11, tmdbId: 600, title: 'Film B', overview: '', backdropUrl: 'http://exemple.test/b.jpg' },
];
const indexes = {} as LightIndexes;

function setup(overrides: Partial<React.ComponentProps<typeof DashboardHero>> = {}) {
  const props = {
    heroMovies: heroes,
    loading: false,
    lightIndexes: indexes,
    play: vi.fn(),
    navigateById: vi.fn(),
    handleWatchlistToggle: vi.fn(),
    ...overrides,
  };
  render(<DashboardHero {...props} />);
  return props;
}

describe('DashboardHero', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rotation.heroIndex = 0;
    rotation.isFading = false;
    vi.mocked(getAllVersionsByTmdb).mockReturnValue([]);
    vi.mocked(getMovieDetail).mockResolvedValue({ stream_id: 10, name: 'Film A', container_extension: 'mkv' } as never);
  });

  describe('Rendu', () => {
    it('affiche le film courant et le nombre de pastilles', () => {
      rotation.heroIndex = 1;
      setup();
      expect(screen.getByTestId('titre')).toHaveTextContent('Film B');
      expect(screen.getByTestId('banniere')).toHaveAttribute('data-total', '2');
      expect(screen.getByTestId('banniere')).toHaveAttribute('data-index', '1');
    });

    it('n\'affiche aucun film quand la liste est vide', () => {
      setup({ heroMovies: [] });
      expect(screen.getByTestId('titre')).toHaveTextContent('');
    });

    it('transmet la pause de l\'accueil à la rotation', () => {
      setup({ paused: true });
      expect(useHeroRotation).toHaveBeenCalledWith(heroes, true);
    });

    it('indique le chargement à la bannière', () => {
      setup({ loading: true });
      expect(screen.getByTestId('banniere')).toHaveAttribute('data-loading', 'true');
    });
  });

  describe('Forçages du DevPanel', () => {
    it('force le fondu', () => {
      setup({ forceFading: true });
      expect(screen.getByTestId('banniere')).toHaveAttribute('data-fading', 'true');
    });

    it('force une bannière vide', () => {
      setup({ forceEmpty: true });
      expect(screen.getByTestId('titre')).toHaveTextContent('');
    });

    it('retire le logo du film', () => {
      setup({ forceNoLogo: true });
      expect(screen.getByTestId('titre')).toHaveTextContent('Film A');
      expect(screen.getByTestId('logo')).toHaveTextContent('');
    });
  });

  describe('Lecture', () => {
    it('charge le film complet puis le lance', async () => {
      const props = setup();
      fireEvent.click(screen.getByText('lecture'));
      await waitFor(() => expect(props.play).toHaveBeenCalledTimes(1));
      expect(getMovieDetail).toHaveBeenCalledWith(10);
      expect(props.navigateById).not.toHaveBeenCalled();
    });

    it('choisit la source dans la langue de l\'application quand il y en a plusieurs', async () => {
      vi.mocked(getAllVersionsByTmdb).mockReturnValue([
        { id: 70, name: 'Film A EN' },
        { id: 71, name: 'Film A FR' },
      ] as never);
      const props = setup();
      fireEvent.click(screen.getByText('lecture'));
      await waitFor(() => expect(props.play).toHaveBeenCalled());
      expect(getAllVersionsByTmdb).toHaveBeenCalledWith(indexes, 500, 'movie');
      expect(getMovieDetail).toHaveBeenCalledWith(71);
    });

    it('garde le numéro du film quand il n\'y a qu\'une source', async () => {
      vi.mocked(getAllVersionsByTmdb).mockReturnValue([{ id: 70, name: 'Film A' }] as never);
      const props = setup();
      fireEvent.click(screen.getByText('lecture'));
      await waitFor(() => expect(props.play).toHaveBeenCalled());
      expect(getMovieDetail).toHaveBeenCalledWith(10);
    });

    it('ouvre la fiche du film quand il est introuvable', async () => {
      vi.mocked(getMovieDetail).mockResolvedValue(null);
      const props = setup();
      fireEvent.click(screen.getByText('lecture'));
      await waitFor(() => expect(props.navigateById).toHaveBeenCalledWith('movie', 10, 500));
      expect(props.play).not.toHaveBeenCalled();
    });

    it('ne fait rien sans film affiché', () => {
      const props = setup({ heroMovies: [] });
      fireEvent.click(screen.getByText('lecture'));
      expect(getMovieDetail).not.toHaveBeenCalled();
      expect(props.play).not.toHaveBeenCalled();
    });
  });

  describe('Infos et Ma liste', () => {
    it('ouvre la fiche du film au clic sur Infos', () => {
      const props = setup();
      fireEvent.click(screen.getByText('infos'));
      expect(props.navigateById).toHaveBeenCalledWith('movie', 10, 500);
    });

    it('ajoute ou retire le film de Ma liste', () => {
      const props = setup();
      fireEvent.click(screen.getByText('maliste'));
      expect(props.handleWatchlistToggle).toHaveBeenCalledWith(10, 500, 'movie');
    });

    it('utilise 0 comme identifiant TMDB quand il manque', () => {
      const props = setup({ heroMovies: [{ ...heroes[0], tmdbId: undefined }] });
      fireEvent.click(screen.getByText('maliste'));
      expect(props.handleWatchlistToggle).toHaveBeenCalledWith(10, 0, 'movie');
    });

    it('ne fait rien sans film affiché', () => {
      const props = setup({ heroMovies: [] });
      fireEvent.click(screen.getByText('infos'));
      fireEvent.click(screen.getByText('maliste'));
      expect(props.navigateById).not.toHaveBeenCalled();
      expect(props.handleWatchlistToggle).not.toHaveBeenCalled();
    });
  });
});
