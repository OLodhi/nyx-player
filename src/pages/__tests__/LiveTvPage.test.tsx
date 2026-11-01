/**
 * LiveTvPage : la liste « Favoris » suit les favoris relus depuis la base (synchro avec un autre
 * appareil, chargement), sans se recalculer quand on retire un favori depuis la liste elle-même
 * (la sélection à la télécommande ne doit pas sauter).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { IptvStream } from '../../types/iptv';
import { LIVE_TV_BOOKMARKS_EVENT } from '../../services/eventConstants';
import { setTvMode } from '../../utils/platform';
import { forgetLaunchedChannel } from '../../utils/liveTvLastChannel';

// ============================================================================
// MOCKS
// ============================================================================

const mocks = vi.hoisted(() => ({
    favorites: new Set<number>(),
    playing: null as unknown,
    play: vi.fn(),
    setActivePage: vi.fn(),
    overrides: { liveTvPage: { forceEmpty: false, forceLoading: false, forceError: null } },
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../LiveTvPage.css', () => ({}));
vi.mock('../../contexts/PlayerContext', () => ({
    usePlayer: () => ({ play: mocks.play, currentlyPlaying: mocks.playing }),
}));
vi.mock('../../contexts/DevOverrideContext', () => ({
    useDevOverrides: () => ({ overrides: mocks.overrides, setActivePage: mocks.setActivePage }),
}));
vi.mock('../../services/liveTvBookmarksService', () => ({
    getFavorites: () => new Set(mocks.favorites),
}));
vi.mock('../../components/Tv/ChannelGrid', () => ({
    default: ({ channels, onChannelClick, restoreStreamId, returns }: {
        channels: IptvStream[]; onChannelClick: (c: IptvStream) => void; restoreStreamId?: number | null; returns?: number;
    }) => (
        <ul data-testid="channel-grid" data-restore={String(restoreStreamId)} data-returns={returns}>
            {channels.map((c) => <li key={c.stream_id} onClick={() => onChannelClick(c)}>{c.name}</li>)}
        </ul>
    ),
}));
vi.mock('../../components/Tv/GuideTvGrid', () => ({ GuideTvGrid: () => null }));
vi.mock('../../hooks/useGuideTvData', () => ({ useGuideTvData: () => ({}) }));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import LiveTvPage from '../LiveTvPage';

function channel(id: number, name: string): IptvStream {
    return { num: id, name, stream_type: 'live', stream_id: id, stream_icon: '', added: '', category_id: '1', tmdb: 0 };
}

const STREAMS = [channel(1, 'Chaîne Un'), channel(2, 'Chaîne Deux')];

function emit(type: string) {
    act(() => {
        window.dispatchEvent(new CustomEvent(LIVE_TV_BOOKMARKS_EVENT, { detail: { type } }));
    });
}

function renderFavorites() {
    return render(
        <LiveTvPage categories={[]} streams={STREAMS} selectedCategory="favorites" viewMode="grid" />,
    );
}

describe('LiveTvPage — favorites list', () => {
    beforeEach(() => {
        mocks.favorites = new Set([1]);
    });

    it('shows a favorite that arrives through the sync (reload event)', () => {
        renderFavorites();
        expect(screen.getByText('Chaîne Un')).toBeInTheDocument();
        expect(screen.queryByText('Chaîne Deux')).not.toBeInTheDocument();

        // La synchro ajoute un favori venu d'un autre appareil puis relit la base
        mocks.favorites = new Set([1, 2]);
        emit('reload');

        expect(screen.getByText('Chaîne Deux')).toBeInTheDocument();
    });

    it('shows the favorites loaded at startup (init event)', () => {
        mocks.favorites = new Set();
        renderFavorites();
        expect(screen.queryByTestId('channel-grid')).not.toBeInTheDocument();

        mocks.favorites = new Set([2]);
        emit('init');

        expect(screen.getByText('Chaîne Deux')).toBeInTheDocument();
    });

    it('keeps the list as is when a favorite is toggled from the list (selection does not jump)', () => {
        renderFavorites();

        // Favori retiré depuis la liste elle-même : la chaîne reste affichée
        mocks.favorites = new Set();
        emit('favorite');

        expect(screen.getByText('Chaîne Un')).toBeInTheDocument();
    });
});

describe('LiveTvPage — retour du lecteur sur TV', () => {
    beforeEach(() => {
        mocks.favorites = new Set();
        mocks.playing = null;
        forgetLaunchedChannel();
        setTvMode(true);
    });
    afterEach(() => setTvMode(false));

    const renderCategory = () =>
        render(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="1" viewMode="grid" />);

    it('mémorise la chaîne lancée et prévient la grille à chaque retour du lecteur', () => {
        const { rerender } = renderCategory();
        const grid = () => screen.getByTestId('channel-grid');
        expect(grid().dataset.restore).toBe('null');

        act(() => screen.getByText('Chaîne Deux').click());
        expect(mocks.play).toHaveBeenCalled();

        // La lecture démarre : la page se redessine, la grille connaît la chaîne à retrouver
        mocks.playing = { stream_id: 2 };
        rerender(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="1" viewMode="grid" />);
        expect(grid().dataset.restore).toBe('2');
        expect(grid().dataset.returns).toBe('0');

        mocks.playing = null;
        rerender(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="1" viewMode="grid" />);
        expect(grid().dataset.returns).toBe('1');
    });

    it('hors TV (Windows, téléphone), le retour du lecteur ne déclenche rien', () => {
        setTvMode(false);
        const { rerender } = renderCategory();
        mocks.playing = { stream_id: 2 };
        rerender(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="1" viewMode="grid" />);
        mocks.playing = null;
        rerender(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="1" viewMode="grid" />);
        expect(screen.getByTestId('channel-grid').dataset.returns).toBe('0');
    });

    it('une autre catégorie ne retrouve pas la chaîne', () => {
        renderCategory();
        act(() => screen.getByText('Chaîne Un').click());
        render(<LiveTvPage categories={[]} streams={STREAMS} selectedCategory="2" viewMode="grid" />);
        const grids = screen.getAllByTestId('channel-grid');
        expect(grids[grids.length - 1].dataset.restore).toBe('null');
    });
});
