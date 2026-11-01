/**
 * Liste des épisodes du lecteur (EpisodeSwitcher).
 * Série pas encore chargée, saison vide, épisode en cours introuvable, fermeture. Données factices,
 * TMDB imité.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AppSeriesInfo, XtreamEpisode } from '../../../types/xtream';
import type { PlayableItem } from '../../../types/player';

const { requestMemoryPurge } = vi.hoisted(() => ({ requestMemoryPurge: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => (key === 'select_season' ? `Saison ${(opts as { num: string }).num}` : key),
  }),
}));
vi.mock('../../../hooks/useTmdbSeries', () => ({
  useTmdbSeries: () => ({ currentSeasonEpisodes: [], isSeasonLoading: false }),
}));
vi.mock('../../../services/memoryService', () => ({ requestMemoryPurge }));
vi.mock('../../../services/tmdbApi', () => ({ default: { imageUrl: () => null } }));

import EpisodeSwitcher from '../EpisodeSwitcher';

const ep = (id: string, num: number): XtreamEpisode => ({ id, episode_num: num, title: `Épisode ${id}`, container_extension: 'mkv' });

const series: AppSeriesInfo = {
  series_id: 7,
  name: 'Série test',
  episodes: {
    '10': [ep('1001', 1)],
    '2': [ep('201', 1), ep('202', 2)],
    '1': [ep('101', 1), ep('102', 2), ep('103', 3)],
  },
} as unknown as AppSeriesInfo;

function renderSwitcher(props: Partial<React.ComponentProps<typeof EpisodeSwitcher>> = {}) {
  const onClose = vi.fn();
  const onPlayEpisode = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <EpisodeSwitcher
      isOpen
      onClose={onClose}
      currentSeries={series}
      currentlyPlaying={null}
      onPlayEpisode={onPlayEpisode}
      {...props}
    />,
  );
  return { ...view, onClose, onPlayEpisode };
}

const titles = () => Array.from(document.querySelectorAll('.episode-list-item img')).map((img) => img.getAttribute('alt'));

describe('EpisodeSwitcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestMemoryPurge.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('série pas encore chargée : indicateur de chargement, pas de plantage', () => {
    renderSwitcher({ currentSeries: null });
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(document.querySelector('.episode-list-item')).toBeNull();
  });

  it('rien en cours : ouvre la première saison dans l\'ordre des nombres (1, 2, 10)', () => {
    renderSwitcher();
    expect(titles()).toEqual(['E1 - Épisode 101', 'E2 - Épisode 102', 'E3 - Épisode 103']);
    const options = Array.from(document.querySelectorAll('.nyx-dropdown__item-label')).map((o) => o.textContent);
    expect(options).toEqual(['Saison 1', 'Saison 2', 'Saison 10']);
  });

  it('épisode en cours : ouvre sa saison et le marque', () => {
    renderSwitcher({ currentlyPlaying: ep('202', 2) as PlayableItem });
    expect(titles()).toEqual(['E1 - Épisode 201', 'E2 - Épisode 202']);
    expect(document.querySelector('.episode-list-item.is-active img')).toHaveAttribute('alt', 'E2 - Épisode 202');
  });

  it('épisode en cours introuvable dans la série : repli sur la première saison', () => {
    renderSwitcher({ currentlyPlaying: ep('999', 9) as PlayableItem });
    expect(titles()[0]).toBe('E1 - Épisode 101');
    expect(document.querySelector('.episode-list-item.is-active')).toBeNull();
  });

  it('série sans aucun épisode : liste vide, pas de sélecteur de saison', () => {
    renderSwitcher({ currentSeries: { ...series, episodes: {} } });
    expect(document.querySelector('.episode-list-item')).toBeNull();
    expect(document.querySelector('.nyx-dropdown')).toBeNull();
  });

  it('choisir un épisode (clic ou OK) : ferme la liste puis lance la lecture avec la série', () => {
    const { onClose, onPlayEpisode } = renderSwitcher();
    const items = document.querySelectorAll<HTMLElement>('.episode-list-item');
    fireEvent.keyDown(items[1], { key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPlayEpisode).toHaveBeenCalledWith(expect.objectContaining({ id: '102' }), series);
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(onPlayEpisode.mock.invocationCallOrder[0]);

    fireEvent.click(items[2]);
    expect(onPlayEpisode).toHaveBeenLastCalledWith(expect.objectContaining({ id: '103' }), series);
  });

  it('changer de saison dans le sélecteur', () => {
    renderSwitcher();
    fireEvent.click(screen.getAllByText('Saison 10').find((el) => el.closest('.nyx-dropdown__item'))!);
    expect(titles()).toEqual(['E1 - Épisode 1001']);
  });

  it('fermée : retirée du parcours du focus (inert) et le fond ne réagit plus', () => {
    const { onClose, rerender, onPlayEpisode } = renderSwitcher();
    const backdrop = document.querySelector('.episode-switcher-backdrop')!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<EpisodeSwitcher isOpen={false} onClose={onClose} currentSeries={series} currentlyPlaying={null} onPlayEpisode={onPlayEpisode} />);
    expect(document.querySelector('.episode-switcher-overlay')).toHaveAttribute('inert');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fermée après avoir affiché des images : mémoire libérée une fois l\'animation finie', () => {
    const { rerender, onClose, onPlayEpisode } = renderSwitcher();
    rerender(<EpisodeSwitcher isOpen={false} onClose={onClose} currentSeries={series} currentlyPlaying={null} onPlayEpisode={onPlayEpisode} />);
    act(() => { vi.advanceTimersByTime(399); });
    expect(requestMemoryPurge).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(requestMemoryPurge).toHaveBeenCalledTimes(1);
  });

  it('ouverture : défile jusqu\'à l\'épisode en cours après le glissement', () => {
    const original = Element.prototype.scrollIntoView;
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderSwitcher({ currentlyPlaying: ep('103', 3) as PlayableItem });
      act(() => { vi.advanceTimersByTime(350); });
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('chargement forcé (DevPanel) : cartes squelettes', () => {
    renderSwitcher({ forceSkeletonLoading: true });
    expect(document.querySelectorAll('.episode-list-item.is-loading')).toHaveLength(3);
  });

  // À la réouverture, le premier rendu lisait encore la garde de fermeture (remise à zéro dans un
  // effet, après le rendu) et ne montrait aucun épisode jusqu'au prochain redessin du lecteur (en pause :
  // jamais)
  it('rouverte juste après la fermeture (moins de 0,4 s) : les épisodes sont affichés', () => {
    const { rerender, onClose, onPlayEpisode } = renderSwitcher();
    const shown = titles().length;
    expect(shown).toBeGreaterThan(0);
    const props = { onClose, onPlayEpisode, currentSeries: series, currentlyPlaying: null };
    rerender(<EpisodeSwitcher isOpen={false} {...props} />);
    rerender(<EpisodeSwitcher isOpen {...props} />); // sans laisser passer les 400 ms
    expect(titles()).toHaveLength(shown);
  });
});
