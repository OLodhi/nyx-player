/**
 * « Voir tout » sur TV en version C (comme les rangées de l'accueil TV) : affiche réduite, posée à son tour par la file
 * des affiches (rangée de la sélection, puis l'écran, le reste à l'arrêt), case grise nue d'ici là, sans fondu.
 * Bureau et téléphone inchangés ; le témoin des mesures rend l'affiche d'avant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import CategoryDetailCard from '../CategoryDetailCard';
import { gridPosterRank, setGridPostersPaced } from '../gridPoster';
import { setTvMode } from '../../../utils/platform';
import { noteArrow, STILL_DELAY_MS } from '../../../utils/spatialNavigation/navigationRest';
import type { IptvStream } from '../../../types/iptv';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../services/watchlistHydration', () => ({
    isInWatchlist: vi.fn(() => Promise.resolve(false)),
    onWatchlistChange: () => () => {},
}));

const TMDB = 'https://image.tmdb.org/t/p/w342/affiche.jpg';
const film = (name: string, icon = TMDB) => ({ stream_id: name.length, name, stream_icon: icon, tmdb: 550 }) as unknown as IptvStream;
const img = (name = 'Film test') => screen.getByRole('button', { name }).querySelector('img');

// Horloge qui avance d'un test à l'autre : la dernière flèche d'un test ne fait pas « bouger » le suivant
let clock = Date.UTC(2030, 0, 1);
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    clock += 60_000;
    vi.setSystemTime(clock);
    setTvMode(true);
});
afterEach(() => {
    setTvMode(false);
    setGridPostersPaced(true);
    vi.useRealTimers();
    document.body.innerHTML = '';
});

/** La sélection ne bouge plus : la file des affiches sert ce qui attend, quelques-unes par image */
function stopMoving(): void {
    act(() => { vi.advanceTimersByTime(STILL_DELAY_MS + 200); });
}

describe('« Voir tout » TV, version C', () => {
    it('au repos : affiche TMDB réduite en 185 px, sans texte de remplacement, invisible jusqu\'à son arrivée', () => {
        render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const image = img()!;
        expect(image).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/affiche.jpg');
        expect(image).toHaveAttribute('alt', '');
        expect(image.style.visibility).toBe('hidden');
        fireEvent.load(image);
        expect(image.style.visibility).toBe('');
    });

    it('en plein mouvement : case grise nue (image sans adresse), affiche posée à l\'arrêt de la sélection', () => {
        act(() => noteArrow());
        render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const image = img()!;
        expect(image).not.toHaveAttribute('src');
        expect(image).toHaveAttribute('alt', '');
        stopMoving();
        expect(image).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/affiche.jpg');
    });

    it('carte retirée avant son tour : rien n\'est posé', () => {
        act(() => noteArrow());
        const { unmount } = render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const image = img()!;
        unmount();
        stopMoving();
        expect(image).not.toHaveAttribute('src');
    });

    it('adresse changée en plein mouvement : case grise jusqu\'à son tour, pas l\'ancienne affiche', () => {
        const { rerender } = render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        expect(img()).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/affiche.jpg');
        act(() => noteArrow());
        rerender(<CategoryDetailCard item={film('Film test', 'https://image.tmdb.org/t/p/w342/nouvelle.jpg')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        expect(img()).not.toHaveAttribute('src');
        stopMoving();
        expect(img()).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/nouvelle.jpg');
    });

    it('affiche introuvable : le titre la remplace', () => {
        render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        fireEvent.error(img()!);
        expect(img()).toBeNull();
        expect(screen.getByText('Film test', { selector: '.fallback-title' })).toBeInTheDocument();
    });

    it('rang dans la file : 0 rangée de la sélection, 1 à l\'écran, 2 hors de l\'écran', () => {
        const row = document.createElement('div');
        const [selected, other] = [document.createElement('button'), document.createElement('div')];
        row.append(selected, other);
        const below = document.createElement('div');
        document.body.append(row, below);
        selected.focus();
        other.getBoundingClientRect = () => ({ top: 100, bottom: 400, left: 0, right: 200 }) as DOMRect;
        below.getBoundingClientRect = () => ({ top: innerHeight + 50, bottom: innerHeight + 350, left: 0, right: 200 }) as DOMRect;
        expect(gridPosterRank(other)).toBe(0);
        const alone = document.createElement('div');
        alone.appendChild(below);
        document.body.appendChild(alone);
        expect(gridPosterRank(below)).toBe(2);
        below.getBoundingClientRect = () => ({ top: 100, bottom: 400, left: 0, right: 200 }) as DOMRect;
        expect(gridPosterRank(below)).toBe(1);
    });

    it('témoin des mesures : l\'affiche d\'avant (adresse d\'origine tout de suite, même en mouvement, avec le titre)', () => {
        setGridPostersPaced(false);
        act(() => noteArrow());
        render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        expect(img()).toHaveAttribute('src', TMDB);
        expect(img()).toHaveAttribute('alt', 'Film test');
    });

    it('hors TV : inchangé', () => {
        setTvMode(false);
        act(() => noteArrow());
        render(<CategoryDetailCard item={film('Film test')} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        expect(img()).toHaveAttribute('src', TMDB);
        expect(img()).toHaveAttribute('alt', 'Film test');
    });
});
