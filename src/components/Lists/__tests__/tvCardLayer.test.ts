/**
 * Calque de sélection d'une rangée TV (rail/railRow.ts) : la carte ne porte ni bouton Ma liste ni note, le calque les
 * pose sur la carte sélectionnée, avec l'état Ma liste lu une fois pour tout l'accueil.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachCardLayer, LAYER_MOVING } from '../tvCardLayerLogic';
import type { CarouselItem } from '../CarouselCard';

const keys = vi.hoisted(() => ({ current: null as Set<string> | null, listeners: new Set<() => void>() }));
vi.mock('../../../hooks/useWatchlistKeys', () => ({
    currentWatchlistKeys: () => keys.current,
    onWatchlistKeys: (listener: () => void) => { keys.listeners.add(listener); return () => keys.listeners.delete(listener); },
}));
vi.mock('../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: vi.fn(() => Promise.resolve(true)) }));

const film: CarouselItem = { id: 1, title: 'Film test', image: 'https://image.tmdb.org/t/p/w185/a.jpg', mediaType: 'movie', tmdbId: 550, overlayText: '★ 8.4' };

/** Piste d'une rangée comme la pose le rail : places `[data-index]` déplacées par `translateX`. */
function row(items: CarouselItem[]) {
    const track = document.createElement('div');
    const cards = items.map((item, i) => {
        const place = document.createElement('div');
        place.setAttribute('data-index', String(i));
        place.style.transform = `translateX(${i * 200}px)`;
        const card = document.createElement('div');
        card.className = item.isActionButton ? 'carousel-card action-button' : 'carousel-card';
        card.tabIndex = 0;
        place.appendChild(card);
        track.appendChild(place);
        return card;
    });
    const layer = document.createElement('div');
    layer.innerHTML = '<div class="card-overlay-text"></div><button class="watchlist-btn card-watchlist-btn"></button>';
    track.appendChild(layer);
    const outside = document.createElement('button');
    document.body.append(track, outside);
    const { detach, refresh } = attachCardLayer(track, layer, (i) => items[i]);
    const button = layer.querySelector<HTMLElement>('.card-watchlist-btn')!;
    const rating = layer.querySelector<HTMLElement>('.card-overlay-text')!;
    return { track, cards, layer, button, rating, outside, detach, refresh };
}

describe('calque de sélection d\'une rangée TV', () => {
    beforeEach(() => { keys.current = new Set(['tmdb:movie:550']); keys.listeners.clear(); });
    afterEach(() => { document.body.replaceChildren(); });

    it('se pose sur la carte sélectionnée, agrandi comme elle, avec sa note et son état Ma liste', () => {
        const serie: CarouselItem = { id: 2, title: 'Série', image: '', mediaType: 'series', tmdbId: 7, overlayText: '★ 7.0' };
        const { cards, layer, button, rating } = row([film, serie]);
        expect(layer.hidden).toBe(true);

        cards[0].focus();
        expect(layer.hidden).toBe(false);
        expect(layer.style.translate).toBe('0px'); // l'agrandissement est celui de tv.css, appliqué après le décalage
        expect(rating.textContent).toBe('★ 8.4');
        expect(button).toHaveClass('watchlist-btn--added');

        cards[1].focus();
        expect(layer.style.translate).toBe('200px');
        expect(rating.textContent).toBe('★ 7.0');
        expect(button).not.toHaveClass('watchlist-btn--added');
    });

    it('disparaît quand la sélection quitte la rangée, et sur « Voir tout »', () => {
        const { cards, layer, outside } = row([film, { id: 'all', title: 'Voir tout', image: '', isActionButton: true }]);
        cards[0].focus();
        outside.focus();
        expect(layer.hidden).toBe(true);
        cards[1].focus();
        expect(layer.hidden).toBe(true);
    });

    it('sans note ni Ma liste, rien n\'est montré', () => {
        const { cards, button, rating } = row([{ id: 3, title: 'Chaîne', image: '' }]);
        cards[0].focus();
        expect(rating.hidden).toBe(true);
        expect(button.hidden).toBe(true);
    });

    it('« Reprendre » : le calque ne répète pas le badge resté sur la carte', () => {
        const { cards, rating } = row([{ ...film, overlayText: '▶ S1E4', showPlayButton: true }]);
        cards[0].focus();
        expect(rating.hidden).toBe(true);
    });

    it('liste changée sous la sélection (note arrivée) : le calque suit sans nouvel appui', () => {
        const items = [film];
        const { cards, rating, refresh } = row(items);
        cards[0].focus();
        items[0] = { ...film, overlayText: '★ 9.1' };
        refresh();
        expect(rating.textContent).toBe('★ 9.1');
    });

    it('suit Ma liste modifiée pendant la sélection (appui long sur la carte), puis se détache', () => {
        const { cards, button, detach } = row([film]);
        cards[0].focus();
        keys.current = new Set();
        keys.listeners.forEach((listener) => listener());
        expect(button).not.toHaveClass('watchlist-btn--added');
        detach();
        expect(keys.listeners.size).toBe(0);
    });

    it('changement de carte : l\'état Ma liste change sans l\'animation de bascule, gardée pour un vrai ajout', () => {
        const frames: FrameRequestCallback[] = [];
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { frames.push(cb); return frames.length; });
        try {
            const autre: CarouselItem = { ...film, id: 2, tmdbId: 8 };
            const { cards, layer, button, refresh } = row([film, autre]);
            cards[0].focus();
            frames.splice(0).forEach((cb) => cb(0));
            frames.splice(0).forEach((cb) => cb(0));
            cards[1].focus();
            // Même calcul de style que le nouvel état : le ✓ ne se change pas en « + » sous les yeux
            expect(layer).toHaveClass(LAYER_MOVING);
            expect(button).not.toHaveClass('watchlist-btn--added');
            // Première image : son calcul de style vient après ce rappel, la classe doit encore y être
            frames.splice(0).forEach((cb) => cb(0));
            expect(layer).toHaveClass(LAYER_MOVING);
            frames.splice(0).forEach((cb) => cb(0));
            expect(layer).not.toHaveClass(LAYER_MOVING);

            keys.current = new Set(['tmdb:movie:8']);
            keys.listeners.forEach((listener) => listener());
            expect(button).toHaveClass('watchlist-btn--added');
            expect(layer).not.toHaveClass(LAYER_MOVING);
            // Liste de la rangée rafraîchie sous la même carte : pas de changement de carte, l'animation reste possible
            refresh();
            expect(layer).not.toHaveClass(LAYER_MOVING);
        } finally {
            raf.mockRestore();
        }
    });
});
