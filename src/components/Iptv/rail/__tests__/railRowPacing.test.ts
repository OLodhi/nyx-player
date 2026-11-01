/**
 * Affiches d'une rangée recyclée pendant le défilement : une carte qui reçoit une nouvelle affiche en plein mouvement
 * attend son tour (rangée sélectionnée et cartes à l'écran pendant le mouvement, le reste à l'arrêt), case vide d'ici
 * là. L'ancien comportement (affiche posée tout de suite) reste disponible pour les mesures de comparaison.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarouselItem } from '../../../Lists/CarouselCard';

vi.mock('../../../../hooks/useWatchlistKeys', () => ({
  currentWatchlistKeys: () => null,
  onWatchlistKeys: () => () => {},
}));
vi.mock('../../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: vi.fn() }));
vi.mock('../../../Lists/tvPoster', () => ({
  tvPosterSrc: (url: string) => url,
  onPosterSettled: () => () => {},
  fallbackPosterSrc: () => null,
}));

import { createRailRow, setPacedPosters } from '../railRow';
import { STILL_DELAY_MS, isMoving, noteArrow } from '../../../../utils/spatialNavigation/navigationRest';

const item = (name: string): CarouselItem => ({ id: name, title: name, image: `http://192.0.2.40/${name}.jpg`, mediaType: 'movie', onClick: () => {} });
const data = (items: CarouselItem[]) => ({ title: 'Rangée', items, watchlistLabel: 'Ajouter à ma liste' });
/** Affiche de chaque carte, null pour une case grise */
const posters = (root: HTMLElement) => [...root.querySelectorAll('.carousel-card')].map((card) => card.querySelector('img')?.getAttribute('src') ?? null);

/** Rangée dans son emplacement du rail, comme dans la page */
function placedRow() {
  const slot = document.createElement('div');
  slot.className = 'rail-slot';
  const row = createRailRow();
  slot.append(row.root);
  document.body.append(slot);
  return { row, slot };
}

let clock = Date.UTC(2030, 0, 1);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  // Horloge toujours en avant d'un test à l'autre : la dernière flèche d'un test précédent est loin
  clock += 60_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  setPacedPosters(true);
  vi.advanceTimersByTime(STILL_DELAY_MS * 4);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('affiches posées pendant le défilement', () => {
  it('rangée hors de l\'écran : les cartes restent vides tant que la sélection bouge, puis reçoivent leur affiche à l\'arrêt', () => {
    noteArrow();
    const { row } = placedRow();
    row.fill(data([item('a'), item('b')]), true);
    // Sous l'écran : la priorité est lue au moment de servir
    row.root.querySelectorAll<HTMLElement>('.carousel-card').forEach((card) => {
      card.getBoundingClientRect = () => ({ top: 2000, bottom: 2300, left: 0, right: 200, width: 200, height: 300, x: 0, y: 2000, toJSON: () => ({}) }) as DOMRect;
    });
    expect(posters(row.root)).toEqual([null, null]);
    vi.advanceTimersByTime(STILL_DELAY_MS - 50);
    noteArrow();
    vi.advanceTimersByTime(STILL_DELAY_MS - 50);
    expect(isMoving()).toBe(true);
    expect(posters(row.root)).toEqual([null, null]);
    vi.advanceTimersByTime(100);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/a.jpg', 'http://192.0.2.40/b.jpg']);
    row.destroy();
  });

  it('rangée sélectionnée : ses cartes reçoivent leur affiche en plein mouvement, sans se remettre à attendre', () => {
    noteArrow();
    const { row } = placedRow();
    row.fill(data([item('a')]), true);
    row.root.querySelector<HTMLElement>('.carousel-card')!.focus();
    row.fill(data([item('b')]), false);
    expect(posters(row.root)).toEqual([null]);
    vi.advanceTimersByTime(20);
    expect(isMoving()).toBe(true);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/b.jpg']);
    row.destroy();
  });

  it('carte recyclée en plein mouvement : l\'affiche de l\'ancienne catégorie est retirée tout de suite', () => {
    const { row } = placedRow();
    row.fill(data([item('old')]), true);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/old.jpg']);
    noteArrow();
    row.fill(data([item('new')]), true);
    expect(posters(row.root)).toEqual([null]);
    expect(row.root.querySelector<HTMLImageElement>('.carousel-card img')!.alt).toBe('');
    row.destroy();
  });

  it('nouvelle catégorie avant l\'arrêt : la carte n\'attend plus l\'affiche d\'avant', () => {
    noteArrow();
    const { row } = placedRow();
    row.fill(data([item('a')]), true);
    row.fill(data([item('b')]), true);
    vi.advanceTimersByTime(STILL_DELAY_MS + 50);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/b.jpg']);
    row.destroy();
  });

  it('sélection à l\'arrêt : l\'affiche est posée tout de suite', () => {
    noteArrow();
    vi.advanceTimersByTime(STILL_DELAY_MS * 2);
    const { row } = placedRow();
    row.fill(data([item('a')]), true);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/a.jpg']);
    row.destroy();
  });

  it('ancien comportement (mesures de comparaison) : affiche posée tout de suite, même en mouvement', () => {
    setPacedPosters(false);
    noteArrow();
    const { row } = placedRow();
    row.fill(data([item('a')]), true);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/a.jpg']);
    row.destroy();
  });
});

describe('affiches vidées au repos', () => {
  it('une rangée vidée de ses affiches les reprend au remplissage suivant, cases grises sans texte de remplacement entre-temps', () => {
    const { row } = placedRow();
    row.fill(data([item('a'), item('b')]), true);
    row.dropImages();
    expect(posters(row.root)).toEqual([null, null]);
    expect([...row.root.querySelectorAll('.carousel-card img')].map((img) => img.getAttribute('alt'))).toEqual(['', '']);
    row.fill(data([item('a'), item('b')]), false);
    expect(posters(row.root)).toEqual(['http://192.0.2.40/a.jpg', 'http://192.0.2.40/b.jpg']);
    row.destroy();
  });
});
