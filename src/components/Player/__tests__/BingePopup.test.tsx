/**
 * Fenêtre « Épisode suivant » (BingePopup).
 * Image et titre manquants, image cassée, décompte hors bornes. TMDB est imité (aucun réseau).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { tmdb } = vi.hoisted(() => ({
  tmdb: { episodes: [] as Array<{ episode_number: number; name?: string; still_path?: string | null } | undefined> },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../hooks/useTmdbSeries', () => ({
  useTmdbSeries: () => ({ currentSeasonEpisodes: tmdb.episodes }),
}));

import BingePopup from '../BingePopup';

const baseProps = {
  nextEpisode: { seasonNumber: 1, episodeNumber: 2 },
  countdown: 10,
  onPlayNow: vi.fn(),
  onCancel: vi.fn(),
};

describe('BingePopup', () => {
  beforeEach(() => {
    tmdb.episodes = [];
    baseProps.onPlayNow.mockReset();
    baseProps.onCancel.mockReset();
  });

  it('numéro d\'épisode sur deux chiffres, décompte affiché', () => {
    render(<BingePopup {...baseProps} nextEpisode={{ seasonNumber: 3, episodeNumber: 12 }} countdown={7} />);
    expect(screen.getByText('S03E12')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('Lire maintenant et la croix appellent la bonne action', () => {
    render(<BingePopup {...baseProps} />);
    fireEvent.click(screen.getByText('binge_play_now'));
    expect(baseProps.onPlayNow).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle('binge_cancel'));
    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('ni image ni titre (série inconnue de TMDB, fournisseur muet) : repli sans plantage', () => {
    const { container } = render(<BingePopup {...baseProps} />);
    expect(container.querySelector('.binge-popup-cover-placeholder')).not.toBeNull();
    expect(container.querySelector('.binge-popup-title')).toBeNull();
  });

  it('image du fournisseur cassée : remplacée par le repli', () => {
    const { container } = render(<BingePopup {...baseProps} nextEpisode={{ seasonNumber: 1, episodeNumber: 2, episodeCover: 'https://example.invalid/e2.jpg' }} />);
    const img = container.querySelector('img')!;
    expect(img).toHaveClass('is-episode-image');
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.binge-popup-cover-placeholder')).not.toBeNull();
  });

  it('affiche de la série en dernier recours', () => {
    const { container } = render(<BingePopup {...baseProps} seriesCover="https://example.invalid/serie.jpg" seriesName="Série" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveClass('is-poster-image');
    expect(img).toHaveAttribute('alt', 'Série');
  });

  it('TMDB prioritaire, et la liste TMDB à trous ne fait pas planter la recherche', () => {
    tmdb.episodes = [undefined, { episode_number: 1, name: 'Un' }, { episode_number: 2, name: 'Deux', still_path: '/deux.jpg' }];
    const { container } = render(<BingePopup {...baseProps} nextEpisode={{ seasonNumber: 1, episodeNumber: 2, episodeTitle: 'Titre fournisseur' }} />);
    expect(screen.getByText('Deux')).toBeInTheDocument();
    expect(container.querySelector('img')!.getAttribute('src')).toContain('/deux.jpg');
  });

  it('titre du fournisseur si TMDB ne connaît pas l\'épisode', () => {
    tmdb.episodes = [undefined, { episode_number: 1, name: 'Un' }];
    render(<BingePopup {...baseProps} nextEpisode={{ seasonNumber: 1, episodeNumber: 2, episodeTitle: 'Titre fournisseur' }} />);
    expect(screen.getByText('Titre fournisseur')).toBeInTheDocument();
  });

  it.each([
    [15, 15, 0],
    [30, 15, 0],
    [0, 15, 1],
    [-3, 15, 1],
  ])('décompte %i sur %i : anneau borné (part vide %f)', (countdown, max, emptyShare) => {
    const { container } = render(<BingePopup {...baseProps} countdown={countdown} countdownMax={max} />);
    const ring = container.querySelector('.countdown-ring-fill')!;
    const circumference = Number(ring.getAttribute('stroke-dasharray'));
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * emptyShare);
  });
});
