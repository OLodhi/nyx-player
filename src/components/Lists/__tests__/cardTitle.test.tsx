/**
 * Titre des cartes d'affiche sur TV : survol sans souris ignoré, titre de la carte focusée, boucle du titre trop long.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CarouselCard } from '../CarouselCard';
import CategoryDetailCard from '../CategoryDetailCard';
import { hoverOpensDetails, markTitleOverflow } from '../cardTitle';
import { setTvMode } from '../../../utils/platform';
import type { IptvStream } from '../../../types/iptv';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/watchlistHydration', () => ({
    isInWatchlist: vi.fn(() => Promise.resolve(false)),
    onWatchlistChange: () => () => undefined,
}));

afterEach(() => {
    setTvMode(false);
    document.documentElement.classList.remove('nyx-pointer');
    vi.useRealTimers();
});

describe('survol de la souris sur TV', () => {
    it('bureau : le survol ouvre les détails ; TV : seulement après un vrai geste de souris', () => {
        expect(hoverOpensDetails()).toBe(true);
        setTvMode(true);
        expect(hoverOpensDetails()).toBe(false);
        document.documentElement.classList.add('nyx-pointer');
        expect(hoverOpensDetails()).toBe(true);
    });

    it('TV : un survol sans souris ne laisse pas une carte ouverte (agrandie, titre qui défile) sans le focus', () => {
        setTvMode(true);
        vi.useFakeTimers();
        render(<CarouselCard item={{ id: 1, title: 'Film test', image: '' }} dragStarted={false} />);
        const card = screen.getByTestId('carousel-card');
        fireEvent.mouseEnter(card);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(card).not.toHaveClass('show-details');
    });

    it('TV : même règle pour les cartes de « Voir tout »', () => {
        setTvMode(true);
        vi.useFakeTimers();
        const item = { stream_id: 42, name: 'Film test', stream_icon: '', tmdb: 550 } as unknown as IptvStream;
        render(<CategoryDetailCard item={item} type="movies" onSelect={vi.fn()} cardWidth={200} />);
        const card = screen.getByTestId('category-card');
        fireEvent.mouseEnter(card);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(card).not.toHaveClass('show-details');
    });
});

describe('titre de la carte focusée sur TV', () => {
    function sized(card: HTMLElement, textWidth: number, boxWidth: number) {
        const box = card.querySelector<HTMLElement>('.card-title')!;
        const text = box.querySelector<HTMLElement>('.title-text')!;
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: textWidth });
        Object.defineProperty(box, 'clientWidth', { configurable: true, value: boxWidth });
        text.style.paddingRight = '48px';
    }

    it('au focus, le titre trop long est marqué pour défiler ; celui qui tient (marge de la boucle exclue) ne l’est pas', () => {
        setTvMode(true);
        render(<CarouselCard item={{ id: 1, title: 'Un titre bien trop long pour la carte', image: '' }} dragStarted={false} />);
        const card = screen.getByTestId('carousel-card');
        sized(card, 400, 200);
        fireEvent.focus(card);
        expect(card).toHaveAttribute('data-title-overflow');
        sized(card, 220, 200); // 172 px de texte + 48 px de marge : tient
        fireEvent.focus(card);
        expect(card).not.toHaveAttribute('data-title-overflow');
    });

    it('TV : la seconde copie du titre (boucle) est présente, cachée aux lecteurs d’écran', () => {
        setTvMode(true);
        render(<CarouselCard item={{ id: 1, title: 'Film test', image: '' }} dragStarted={false} />);
        const copy = screen.getByTestId('carousel-card').querySelector('.title-text--copy');
        expect(copy).toHaveAttribute('aria-hidden', 'true');
    });

    it('« Voir tout » : la marge intérieure du bandeau ne compte pas comme place pour le texte', () => {
        const card = document.createElement('div');
        const box = document.createElement('div');
        box.style.padding = '0 12px';
        const text = document.createElement('span');
        text.className = 'title-text';
        text.style.paddingRight = '48px';
        box.append(text);
        card.append(box);
        Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 260 }); // 212 px de texte
        Object.defineProperty(box, 'clientWidth', { configurable: true, value: 224 }); // 200 px de place
        markTitleOverflow(card, box);
        expect(card.hasAttribute('data-title-overflow')).toBe(true);
    });

    it('sans cadre de titre : rien ne change', () => {
        const card = document.createElement('div');
        markTitleOverflow(card, null);
        expect(card.hasAttribute('data-title-overflow')).toBe(false);
    });
});

describe('boucle du titre trop long', () => {
    const css = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const keyframes = (source: string, name: string) =>
        [...source.matchAll(new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?\\})\\s*\\}`, 'g'))].map((m) => m[1]);

    it('chaque copie avance de sa propre largeur (-100 %), une seule définition : pas de retour au début à mi-chemin', () => {
        const carousel = keyframes(css('../ContentCarousel.css'), 'marquee');
        expect(carousel).toHaveLength(1);
        expect(carousel[0]).toMatch(/100%\s*\{\s*transform:\s*translateX\(-100%\)/);
        const category = keyframes(css('../../../pages/CategoryDetailPage.css'), 'categoryMarquee');
        expect(category).toHaveLength(1);
        expect(category[0]).toMatch(/100%\s*\{\s*transform:\s*translateX\(-100%\)/);
    });
});
