/**
 * Rangée du rail présentée comme un carrousel de Suggestions : titre et repères de la rangée React, cartes « Reprendre »
 * (barre de progression, bouton lecture) qui ne laissent rien à la carte recyclée, rangée d'attente du chargement, et
 * cartes construites par tranches pour une longue rangée.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CarouselItem } from '../../../Lists/CarouselCard';

vi.mock('../../../../hooks/useWatchlistKeys', () => ({
  currentWatchlistKeys: () => null,
  onWatchlistKeys: () => () => {},
}));
vi.mock('../../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: vi.fn() }));

import { carouselDims } from '../../../Lists/VirtualContentCarousel';
import { CARD_BATCH, CARD_BATCH_AHEAD, createRailRow, type RailRow, type RailRowData } from '../railRow';

/** Ce que le banc évite d'ouvrir sur la box (une carte qui lancerait la lecture) */
const SAFE_CARD = '.carousel-card:not(:has(.card-play-button)):not(:has(.card-progress-bar))';

const film = (name: string): CarouselItem => ({ id: name, title: name, image: '', mediaType: 'movie', onClick: () => {} });
const resume = (name: string, progress: number, unavailable = false): CarouselItem => ({
  ...film(name),
  progress,
  showPlayButton: !unavailable,
  unavailable,
});
const data = (items: CarouselItem[], title = 'Rangée', loading = false): RailRowData => ({ title, items, watchlistLabel: 'Ajouter à ma liste', loading });
const cards = (row: RailRow) => Array.from(row.root.querySelectorAll<HTMLElement>('[data-testid="carousel-card"]'));
const many = (count: number) => Array.from({ length: count }, (_, i) => film(`film ${i}`));

let row: RailRow;
afterEach(() => {
  row.destroy();
  document.body.innerHTML = '';
});

describe('rangée de Suggestions : titre et repères', () => {
  beforeEach(() => {
    row = createRailRow(1.75, 'carousel');
    document.body.appendChild(row.root);
  });

  it('le titre est dans le carrousel, avec les repères de la rangée React, sans en-tête de catégorie', () => {
    row.fill(data([film('a')], 'Tendances'), true);
    const container = row.root.querySelector('.content-carousel-container')!;
    expect(container).toHaveAttribute('data-testid', 'carousel-row');
    expect(container).toHaveAttribute('data-row-title', 'Tendances');
    expect(row.root.querySelector('[data-testid="carousel-row-title"]')).toHaveTextContent('Tendances');
    expect(row.root.querySelector('[data-testid="carousel-row-title"]')).not.toHaveAttribute('hidden');
    expect(row.root.querySelector('.iptv-category-header')).toBeNull();
    expect(row.root).not.toHaveAttribute('data-testid');
    expect(row.root).toHaveAttribute('data-nav-align');
  });

  it('en chargement : barre grise et cadres immobiles, sans repère du banc ; les cartes arrivées, la vraie rangée', () => {
    row.fill(data([], 'Tendances', true), true);
    const container = row.root.querySelector('.content-carousel-container')!;
    expect(container).not.toHaveAttribute('data-testid');
    expect(container).toHaveAttribute('data-row-title', '');
    expect(row.root.querySelector('.skeleton-title')).not.toHaveAttribute('hidden');
    // Titre vide mais en place : la rangée garde la hauteur d'une rangée remplie, que réservent tous les emplacements
    const title = row.root.querySelector<HTMLElement>('h3.carousel-title')!;
    expect(title).not.toHaveAttribute('hidden');
    expect(title.textContent).toBe('\u00a0');
    expect(title.nextElementSibling).toHaveClass('content-carousel');
    expect(row.root.querySelector('[data-testid="carousel-row-title"]')).toBeNull();
    expect(row.root.querySelectorAll('.carousel-placeholder-frame')).toHaveLength(6);
    expect(cards(row)).toHaveLength(0);

    row.fill(data([film('a')], 'Tendances', true), false);
    expect(container).toHaveAttribute('data-testid', 'carousel-row');
    expect(container).toHaveAttribute('data-row-title', 'Tendances');
    expect(row.root.querySelector('.skeleton-title')).toHaveAttribute('hidden');
    expect(row.root.querySelector('[data-testid="carousel-row-title"]')).toHaveTextContent('Tendances');
    expect(row.root.querySelectorAll('.carousel-placeholder-frame')).toHaveLength(0);
    expect(cards(row)).toHaveLength(1);
  });
});

describe('cartes « Reprendre »', () => {
  beforeEach(() => {
    row = createRailRow(1.75, 'carousel');
    document.body.appendChild(row.root);
  });

  it('barre de progression à la bonne largeur et bouton lecture, entre l\'affiche et le titre, comme CardPoster', () => {
    row.fill(data([resume('a', 42.5), resume('b', 140)]), true);
    const [a, b] = cards(row);
    expect(a.querySelector('[data-testid="carousel-card-progress"] .progress-fill')).toHaveStyle({ width: '42.5%' });
    expect(b.querySelector('.progress-fill')).toHaveStyle({ width: '100%' });
    expect(a.querySelector('[data-testid="carousel-card-play"] .play-icon')).toHaveTextContent('▶');
    expect(Array.from(a.children).map((child) => child.className))
      .toEqual(['card-image-wrapper', 'card-progress-bar', 'card-play-button', 'card-bottom-bar']);
  });

  it('carte « Introuvable » : grisée, sa barre sans bouton lecture', () => {
    row.fill(data([resume('a', 30, true)]), true);
    const [a] = cards(row);
    expect(a).toHaveClass('carousel-card--unavailable');
    expect(a.querySelector('.card-progress-bar')).not.toBeNull();
    expect(a.querySelector('.card-play-button')).toBeNull();
  });

  // Le banc ne choisit une carte à ouvrir que sans barre ni bouton : une place recyclée qui les garderait lancerait
  // la lecture sur la box
  it('une rangée recyclée vers une autre catégorie perd barres et boutons lecture', () => {
    row.fill(data([resume('a', 30), resume('b', 60)], 'Reprendre'), true);
    expect(row.root.querySelectorAll(SAFE_CARD)).toHaveLength(0);
    row.fill(data([film('c'), film('d'), film('e')], 'Tendances'), true);
    expect(row.root.querySelectorAll('.card-progress-bar, .card-play-button')).toHaveLength(0);
    expect(row.root.querySelectorAll(SAFE_CARD)).toHaveLength(3);
    // Et les retrouve en redevenant « Reprendre »
    row.fill(data([resume('a', 30)], 'Reprendre'), true);
    expect(row.root.querySelectorAll('.card-progress-bar')).toHaveLength(1);
    expect(row.root.querySelectorAll('.card-play-button')).toHaveLength(1);
  });

  it('progression mise à jour sur place, sans reconstruire la carte', () => {
    row.fill(data([resume('a', 30)]), true);
    const [before] = cards(row);
    const bar = before.querySelector('.card-progress-bar');
    row.fill(data([resume('a', 55)]), false);
    const [after] = cards(row);
    expect(after).toBe(before);
    expect(after.querySelector('.card-progress-bar')).toBe(bar);
    expect(after.querySelector('.progress-fill')).toHaveStyle({ width: '55%' });
  });
});

describe('construction par tranches', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    row = createRailRow(1.75, 'carousel');
    document.body.appendChild(row.root);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const indexes = () => cards(row).map((card) => Number(card.parentElement!.getAttribute('data-index')));
  const frame = () => vi.advanceTimersByTime(16);
  const contiguous = (count: number) => Array.from({ length: count }, (_, i) => i);

  it('une longue rangée construit sa première tranche, puis la suivante quand la sélection approche du bout', () => {
    row.fill(data(many(30)), true);
    expect(indexes()).toEqual(contiguous(CARD_BATCH));
    // Toute la largeur est réservée d'emblée : la piste défile jusqu'au bout
    const dims = carouselDims(1.75);
    expect(row.root.querySelector<HTMLElement>('.content-carousel > div')!.style.width).toContain(`${30 * (dims.cardW + dims.gapPx)}px`);

    cards(row)[CARD_BATCH - CARD_BATCH_AHEAD - 1].focus();
    frame();
    expect(indexes()).toEqual(contiguous(CARD_BATCH));

    cards(row)[CARD_BATCH - CARD_BATCH_AHEAD].focus();
    // Hors de la tâche de la flèche : à l'image suivante
    expect(indexes()).toEqual(contiguous(CARD_BATCH));
    frame();
    expect(indexes()).toEqual(contiguous(2 * CARD_BATCH));

    cards(row)[2 * CARD_BATCH - 1].focus();
    frame();
    expect(indexes()).toEqual(contiguous(30));
    expect(cards(row)[29]).toHaveAttribute('aria-label', 'film 29');
  });

  it('flèche Droite maintenue jusqu\'au bout : une carte à droite existe toujours avant d\'y arriver', () => {
    row.fill(data(many(30)), true);
    for (let index = 0; index < 29; index += 1) {
      cards(row)[index].focus();
      expect(cards(row)[index + 1]).toBeDefined();
      frame();
    }
    expect(indexes()).toEqual(contiguous(30));
  });

  it('même rangée relue (nouvelle version des données) : les tranches construites restent', () => {
    row.fill(data(many(30)), true);
    cards(row)[CARD_BATCH - 1].focus();
    frame();
    expect(cards(row)).toHaveLength(2 * CARD_BATCH);
    row.fill(data(many(30)), false);
    expect(cards(row)).toHaveLength(2 * CARD_BATCH);
  });

  it('rangée recyclée pour une autre catégorie : elle repart d\'une tranche', () => {
    row.fill(data(many(30)), true);
    cards(row)[CARD_BATCH - 1].focus();
    frame();
    row.fill(data(many(30)), true);
    expect(indexes()).toEqual(contiguous(CARD_BATCH));
  });

  it('rangée courte : toutes ses cartes, sans tranche', () => {
    row.fill(data(many(5)), true);
    expect(indexes()).toEqual(contiguous(5));
    cards(row)[4].focus();
    frame();
    expect(indexes()).toEqual(contiguous(5));
  });
});

describe('rangée de catégorie (Films, Séries)', () => {
  it('garde son en-tête et ses repères', () => {
    row = createRailRow(1.75);
    row.fill(data([film('a')], 'Action'), true);
    expect(row.root).toHaveAttribute('data-testid', 'iptv-category');
    expect(row.root.querySelector('.iptv-category-title')).toHaveTextContent('Action');
    expect(row.root.querySelector('.content-carousel-container')).toHaveAttribute('data-testid', 'carousel-row');
    expect(row.root.querySelector('.skeleton-title')).toBeNull();
  });
});
