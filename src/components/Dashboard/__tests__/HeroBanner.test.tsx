/**
 * Bannière d'accueil (audit performance, fiche F9) : une photo de fond non reçue est redemandée, puis
 * affichée quand même au bout de 12 s ; une photo déjà reçue revient sans attente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

vi.mock('../../../services/watchlistHydration', () => ({
  isInWatchlist: vi.fn(() => Promise.resolve(false)),
  onWatchlistChange: vi.fn(() => () => {}),
}));

import HeroBanner from '../HeroBanner';
import type { HeroMovie } from '../../../types/dashboard';
import { setTvMode } from '../../../utils/platform';

/** Image simulée : l'essai ne réussit que quand le test le décide. */
class FakeImage {
  static instances: FakeImage[] = [];
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  loads = 0;
  constructor() { FakeImage.instances.push(this); }
  set src(_: string) { this.loads += 1; }
}

const movie = (url: string) => ({ id: 1, title: 'Film', backdropUrl: url, overview: '' }) as unknown as HeroMovie;
const noop = () => {};
const banner = (container: HTMLElement) => container.querySelector('.hero-banner') as HTMLElement;

describe('HeroBanner — photo de fond', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('photo non reçue : redemandée après 2 s, affichée dès qu\'elle arrive', async () => {
    const { container } = render(<HeroBanner movie={movie('https://image.tmdb.org/a.jpg')} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} />);
    const img = FakeImage.instances[0];
    expect(banner(container).style.backgroundImage).toBe('');

    act(() => img.onerror?.());
    expect(img.loads).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(img.loads).toBe(2);

    act(() => img.onload?.());
    expect(banner(container).style.backgroundImage).toContain('a.jpg');
  });

  it('toujours rien au bout de 12 s : affichée quand même', async () => {
    const { container } = render(<HeroBanner movie={movie('https://image.tmdb.org/b.jpg')} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(banner(container).style.backgroundImage).toBe('');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(banner(container).style.backgroundImage).toContain('b.jpg');
  });

  it('photo déjà reçue : affichée sans nouveau téléchargement', async () => {
    const first = render(<HeroBanner movie={movie('https://image.tmdb.org/c.jpg')} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} />);
    act(() => FakeImage.instances[0].onload?.());
    first.unmount();

    const again = render(<HeroBanner movie={movie('https://image.tmdb.org/c.jpg')} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} />);
    expect(FakeImage.instances).toHaveLength(1);
    expect(banner(again.container).style.backgroundImage).toContain('c.jpg');
  });
});

describe('HeroBanner — tenue (pause de la rotation)', () => {
  beforeEach(() => { vi.stubGlobal('Image', FakeImage); });
  afterEach(() => { setTvMode(false); vi.unstubAllGlobals(); });

  const monter = () => {
    const onHoldChange = vi.fn();
    const r = render(<HeroBanner movie={movie('https://image.tmdb.org/c.jpg')} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} onHoldChange={onHoldChange} />);
    return { ...r, onHoldChange, bouton: (id: string) => r.container.querySelector(`[data-testid="${id}"]`) as HTMLElement };
  };

  it('souris dessus : tenue ; quittée : relâchée ; le toucher ne compte pas', () => {
    const { container, onHoldChange } = monter();
    fireEvent.pointerEnter(banner(container), { pointerType: 'touch' });
    expect(onHoldChange).not.toHaveBeenCalled();
    fireEvent.pointerEnter(banner(container), { pointerType: 'mouse' });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    fireEvent.pointerLeave(banner(container), { pointerType: 'mouse' });
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it('TV : focus sur un bouton de la bannière, tenue ; d\'un bouton à l\'autre, toujours tenue ; focus parti, relâchée', () => {
    setTvMode(true);
    const { onHoldChange, bouton } = monter();
    act(() => bouton('hero-play').focus());
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    act(() => bouton('hero-watchlist').focus());
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    act(() => bouton('hero-watchlist').blur());
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it('bureau : un bouton qui garde le focus après un clic ne bloque pas la rotation', () => {
    const { onHoldChange, bouton } = monter();
    act(() => bouton('hero-play').focus());
    expect(onHoldChange).not.toHaveBeenCalled();
  });

  it('accueil rechargé pendant la tenue (bannière d\'attente) : relâchée, la rotation ne reste pas bloquée', () => {
    const onHoldChange = vi.fn();
    const props = { onPlay: noop, onInfo: noop, onToggleWatchlist: noop, onHoldChange };
    const { container, rerender } = render(<HeroBanner movie={movie('https://image.tmdb.org/d.jpg')} {...props} />);
    fireEvent.pointerEnter(banner(container), { pointerType: 'mouse' });
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    rerender(<HeroBanner movie={null} loading {...props} />);
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
    rerender(<HeroBanner movie={movie('https://image.tmdb.org/d.jpg')} {...props} />);
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it('démontée en étant tenue : relâchée', () => {
    const { container, onHoldChange, unmount } = monter();
    fireEvent.pointerEnter(banner(container), { pointerType: 'mouse' });
    unmount();
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });
});

describe('HeroBanner — points de changement d\'affiche', () => {
  it('forment leur propre étage de télécommande, réservé à Gauche/Droite depuis les rangées de la bannière', () => {
    const { container } = render(<HeroBanner movie={movie('https://image.tmdb.org/e.jpg')} totalSlides={3} onPlay={noop} onInfo={noop} onToggleWatchlist={noop} />);
    const dots = container.querySelector('.hero-dots') as HTMLElement;
    // Même nom d'étage que Suggestions / Films / Séries : Bas depuis un point sautait ces pastilles et Gauche y revenait
    expect(dots.getAttribute('data-nav-row')).not.toBe('dashboard-modes');
    expect(container.querySelectorAll('.hero-dot[data-nav-lateral-only]')).toHaveLength(3);
  });
});
