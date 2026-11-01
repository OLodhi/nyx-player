/**
 * Carte de « Voir tout » à la télécommande (Chromecast) : aucune affiche n'était atteignable,
 * la carte n'étant pas focusable. Elle est maintenant un arrêt du parcours, et OK ouvre la fiche.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CategoryDetailCard from '../CategoryDetailCard';
import { isInWatchlist } from '../../../services/watchlistHydration';
import type { IptvStream } from '../../../types/iptv';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/watchlistHydration', () => ({
    isInWatchlist: vi.fn(() => Promise.resolve(false)),
    toggleWatchlist: vi.fn(() => Promise.resolve(true)),
    // Même mécanisme que l'app : un événement de la fenêtre à chaque changement de Ma liste
    onWatchlistChange: (callback: () => void) => {
        window.addEventListener('test-watchlist-change', callback);
        return () => window.removeEventListener('test-watchlist-change', callback);
    },
}));

const item = { stream_id: 42, name: 'Film test', stream_icon: '', tmdb: 550 } as unknown as IptvStream;

describe('CategoryDetailCard — télécommande', () => {
    it('la carte est un arrêt du parcours (focusable, rôle bouton)', () => {
        render(<CategoryDetailCard item={item} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const card = screen.getByRole('button', { name: 'Film test' });
        expect(card).toHaveAttribute('tabindex', '0');
    });

    it('OK (Entrée) ouvre la fiche', () => {
        const onClick = vi.fn();
        render(<CategoryDetailCard item={item} type="movies" onSelect={onClick} cardWidth={200} />);
        fireEvent.keyDown(screen.getByRole('button', { name: 'Film test' }), { key: 'Enter' });
        expect(onClick).toHaveBeenCalledTimes(1);
        // La grille passe la même fonction à toutes ses cartes : la carte dit laquelle est choisie
        expect(onClick).toHaveBeenCalledWith(item);
    });

    it('clic (souris, toucher) ouvre la fiche de cette carte', () => {
        const onSelect = vi.fn();
        render(<CategoryDetailCard item={item} type="movies" onSelect={onSelect} cardWidth={200} />);
        fireEvent.click(screen.getByRole('button', { name: 'Film test' }));
        expect(onSelect).toHaveBeenCalledWith(item);
    });
});

// Banc piloté par carte, zone 3 : un titre ajouté à Ma liste depuis sa fiche, ouverte depuis
// « Voir tout », gardait sa carte « + » au retour (la page reste montée sous la fiche et ne relisait pas
// Ma liste), contrairement aux cartes de l'accueil (CarouselCard)
describe('CategoryDetailCard — Ma liste changée ailleurs', () => {
    it('la carte suit Ma liste quand elle change hors de la carte', async () => {
        render(<CategoryDetailCard item={item} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const bouton = screen.getByTestId('category-card-watchlist');
        await waitFor(() => expect(isInWatchlist).toHaveBeenCalled());
        expect(bouton).not.toHaveClass('watchlist-btn--added');

        vi.mocked(isInWatchlist).mockResolvedValue(true);
        await act(async () => { window.dispatchEvent(new Event('test-watchlist-change')); });
        await waitFor(() => expect(bouton).toHaveClass('watchlist-btn--added'));
    });
});
