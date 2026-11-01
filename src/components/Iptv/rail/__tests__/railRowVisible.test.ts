/**
 * Affiches de l'accueil TV, version C : seules les cartes dans la largeur de l'écran reçoivent leur affiche (la rangée
 * sélectionnée prépare en plus l'écran suivant à droite), la rangée où la sélection s'arrête est complétée dès l'arrêt,
 * après ce qui est à l'écran ailleurs, et une carte en attente reste une case grise nue (sans l'icône « image cassée »
 * que dessine le navigateur pour une image dont on a retiré l'adresse).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarouselItem } from '../../../Lists/CarouselCard';

const shrinking = vi.hoisted(() => ({ waiting: new Set<string>(), originals: new Map<string, string>(), settle: new Map<string, () => void>() }));
vi.mock('../../../../hooks/useWatchlistKeys', () => ({
  currentWatchlistKeys: () => null,
  onWatchlistKeys: () => () => {},
}));
vi.mock('../../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: vi.fn() }));
vi.mock('../../../Lists/tvPoster', () => ({
  tvPosterSrc: (url: string) => (shrinking.waiting.has(url) ? null : url),
  onPosterSettled: (url: string, callback: () => void) => {
    shrinking.settle.set(url, callback);
    return () => shrinking.settle.delete(url);
  },
  fallbackPosterSrc: (src: string) => shrinking.originals.get(src) ?? null,
}));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRailRow, setBareWaitingCard, setPacedPosters, type RailRow } from '../railRow';
import { NOT_YET, STILL_DELAY_MS, isMoving, noteArrow, whenStill } from '../../../../utils/spatialNavigation/navigationRest';

const item = (name: string): CarouselItem => ({ id: name, title: name, image: `http://192.0.2.40/${name}.jpg`, mediaType: 'movie', onClick: () => {} });
const data = (items: CarouselItem[]) => ({ title: 'Rangée', items, watchlistLabel: 'Ajouter à ma liste' });
const src = (name: string) => `http://192.0.2.40/${name}.jpg`;
/** Affiche de chaque carte, null pour une carte sans affiche */
const posters = (root: HTMLElement) => [...root.querySelectorAll('.carousel-card')].map((card) => card.querySelector('img')?.getAttribute('src') ?? null);

/** Bord gauche de chaque carte, par rang dans la rangée (jsdom ne calcule aucune position) */
let lefts: number[] = [];
function placeCards(next: number[]): void {
  lefts = next;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const slot = this.closest('[data-index]');
    const left = slot ? lefts[Number(slot.getAttribute('data-index'))] ?? 0 : 0;
    return { left, right: left + 200, top: 0, bottom: 300, width: 200, height: 300, x: left, y: 0, toJSON: () => ({}) };
  });
}

/** Rangée dans son emplacement du rail, comme dans la page */
function placedRow(): RailRow {
  const slot = document.createElement('div');
  slot.className = 'rail-slot';
  const row = createRailRow();
  slot.append(row.root);
  document.body.append(slot);
  return row;
}

let clock = Date.UTC(2031, 0, 1);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  // Horloge toujours en avant d'un test à l'autre : la dernière flèche d'un test précédent est loin
  clock += 60_000;
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.advanceTimersByTime(STILL_DELAY_MS * 4);
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPacedPosters(true);
  setBareWaitingCard(true);
  shrinking.waiting.clear();
  shrinking.originals.clear();
  shrinking.settle.clear();
  document.body.replaceChildren();
});

describe('affiches seulement dans la largeur de l\'écran', () => {
  it('rangée remplie à l\'arrêt : la carte au-delà du bord droit attend, puis arrive quand le défilement l\'amène à l\'écran', () => {
    placeCards([0, innerWidth - 300, innerWidth + 100]);
    const row = createRailRow();
    document.body.append(row.root);
    row.fill(data([item('a'), item('b'), item('c')]), true);
    vi.advanceTimersByTime(STILL_DELAY_MS + 50);
    expect(posters(row.root)).toEqual([src('a'), src('b'), null]);

    placeCards([-400, innerWidth - 700, innerWidth - 300]);
    noteArrow();
    vi.advanceTimersByTime(STILL_DELAY_MS + 50);
    expect(posters(row.root)).toEqual([src('a'), src('b'), src('c')]);
    row.destroy();
  });

  it('en plein mouvement, la rangée sélectionnée prépare l\'écran suivant à droite, pas au-delà', () => {
    const row = placedRow();
    row.fill(data([item('x'), item('y'), item('z')]), true);
    row.root.querySelector<HTMLElement>('.carousel-card')!.focus();
    placeCards([0, innerWidth + 100, 2 * innerWidth + 100]);
    noteArrow();
    row.fill(data([item('a'), item('b'), item('c')]), true);
    vi.advanceTimersByTime(50);
    expect(isMoving()).toBe(true);
    expect(posters(row.root)).toEqual([src('a'), src('b'), null]);
    row.destroy();
  });

  it('une carte loin à droite d\'une autre rangée n\'arrive pas à l\'arrêt', () => {
    const row = placedRow();
    placeCards([0, 3 * innerWidth]);
    noteArrow();
    row.fill(data([item('a'), item('b')]), true);
    vi.advanceTimersByTime(STILL_DELAY_MS * 3);
    expect(posters(row.root)).toEqual([src('a'), null]);
    row.destroy();
  });

  it('une demande pas encore à servir n\'entretient aucune boucle d\'images ni minuteur', () => {
    noteArrow();
    const served: string[] = [];
    whenStill(() => served.push('écran'), () => 1);
    whenStill(() => served.push('loin à droite'), () => NOT_YET);
    vi.advanceTimersByTime(STILL_DELAY_MS + 50);
    expect(served).toEqual(['écran']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ancien rail (témoin des mesures) : toutes les affiches sont posées, même loin à droite', () => {
    setPacedPosters(false);
    placeCards([0, 3 * innerWidth]);
    const row = placedRow();
    row.fill(data([item('a'), item('b')]), true);
    expect(posters(row.root)).toEqual([src('a'), src('b')]);
    row.destroy();
  });
});

describe('rangée où la sélection s\'arrête', () => {
  it('dès l\'arrêt, toute la rangée sélectionnée est servie, après ce qui est à l\'écran ailleurs', () => {
    const row = placedRow();
    const other = placedRow();
    row.fill(data([item('x'), item('y'), item('z')]), true);
    other.fill(data([item('p'), item('q'), item('r')]), true);
    row.root.querySelector<HTMLElement>('.carousel-card')!.focus();
    placeCards([0, innerWidth - 300, 3 * innerWidth]);
    noteArrow();
    row.fill(data([item('a'), item('b'), item('c')]), true);
    other.fill(data([item('d'), item('e'), item('f')]), true);
    const order: string[] = [];
    for (let ms = 0; ms < STILL_DELAY_MS + 200; ms += 1) {
      vi.advanceTimersByTime(1);
      for (const poster of [...posters(row.root), ...posters(other.root)]) if (poster && !order.includes(poster)) order.push(poster);
    }
    // Pendant le mouvement : a et b (rangée sélectionnée, à l'écran), d et e (à l'écran) ; à l'arrêt : c, la carte loin
    // à droite de la rangée sélectionnée ; f, loin à droite d'une autre rangée, attend
    expect(order.slice(0, 4).sort()).toEqual([src('a'), src('b'), src('d'), src('e')]);
    expect(order.slice(4)).toEqual([src('c')]);
    row.destroy();
    other.destroy();
  });

  it('une flèche avant l\'arrêt : la rangée n\'est pas complétée en plein mouvement', () => {
    const row = placedRow();
    row.fill(data([item('x'), item('y')]), true);
    row.root.querySelector<HTMLElement>('.carousel-card')!.focus();
    placeCards([0, 3 * innerWidth]);
    noteArrow();
    row.fill(data([item('a'), item('b')]), true);
    vi.advanceTimersByTime(STILL_DELAY_MS - 50);
    noteArrow();
    vi.advanceTimersByTime(STILL_DELAY_MS - 50);
    expect(isMoving()).toBe(true);
    expect(posters(row.root)).toEqual([src('a'), null]);
    vi.advanceTimersByTime(100);
    expect(posters(row.root)).toEqual([src('a'), src('b')]);
    row.destroy();
  });
});

describe('carte grise en attente, sans icône d\'image cassée', () => {
  // Une image dont on a retiré l'adresse est dessinée par Chromium avec l'icône « image cassée », même sans texte de
  // remplacement : la carte qui attend son affiche garde son image sans adresse, cachée par tv.css
  it('tv.css cache l\'image sans adresse d\'une carte du rail', () => {
    const tvCss = readFileSync(resolve(process.cwd(), 'src/styles/tv.css'), 'utf8');
    expect(tvCss.replace(/\s+/g, ' ')).toContain('.nyx-tv .rail-slot .carousel-card img:not([src]) { visibility: hidden; }');
  });

  it('carte recyclée en plein mouvement : l\'ancienne affiche est retirée, l\'image reste dans la carte', () => {
    const row = placedRow();
    placeCards([0, 0]);
    row.fill(data([item('old')]), true);
    const img = row.root.querySelector('.carousel-card img');
    expect(posters(row.root)).toEqual([src('old')]);
    noteArrow();
    row.fill(data([item('new')]), true);
    expect(row.root.querySelector('.carousel-card img')).toBe(img);
    expect(img!.hasAttribute('src')).toBe(false);
    vi.advanceTimersByTime(STILL_DELAY_MS + 50);
    expect(posters(row.root)).toEqual([src('new')]);
    row.destroy();
  });

  it('carte loin à droite : image sans adresse, sans texte de remplacement', () => {
    const row = placedRow();
    placeCards([0, 3 * innerWidth]);
    row.fill(data([item('a'), item('b')]), true);
    const imgs = [...row.root.querySelectorAll<HTMLImageElement>('.carousel-card img')];
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([src('a'), null]);
    expect(imgs.map((img) => img.alt)).toEqual(['', '']);
    row.destroy();
  });

  it('rangée vidée au repos : ses images perdent leur adresse, et la reprennent au remplissage suivant', () => {
    const row = placedRow();
    row.fill(data([item('a'), item('b')]), true);
    row.dropImages();
    expect(posters(row.root)).toEqual([null, null]);
    row.fill(data([item('a'), item('b')]), false);
    expect(posters(row.root)).toEqual([src('a'), src('b')]);
    row.destroy();
  });

  // Sur la box, la WebView dessine aussi son icône « image » et le texte de remplacement sur une image dont le
  // chargement est en cours (relevé dans la page de la box : src posée, complete faux, alt = titre)
  it('affiche en cours de chargement : invisible jusqu\'à son arrivée, sans texte de remplacement', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    const row = placedRow();
    row.fill(data([item('a')]), true);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    expect(img.getAttribute('src')).toBe(src('a'));
    expect(img.style.visibility).toBe('hidden');
    expect(img.alt).toBe('');
    img.dispatchEvent(new Event('load'));
    expect(img.style.visibility).toBe('');
    row.destroy();
  });

  it('carte recyclée encore cachée : la nouvelle affiche, déjà en cache, est visible tout de suite', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    const row = placedRow();
    row.fill(data([item('a')]), true);
    complete.mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(185);
    row.fill(data([item('b')]), true);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    expect(img.getAttribute('src')).toBe(src('b'));
    expect(img.style.visibility).toBe('');
    row.destroy();
  });

  it('affiche déjà prête (en cache) : visible tout de suite', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(185);
    const row = placedRow();
    row.fill(data([item('a')]), true);
    expect(row.root.querySelector<HTMLImageElement>('.carousel-card img')!.style.visibility).toBe('');
    row.destroy();
  });

  it('affiche en échec puis adresse d\'origine : reste invisible jusqu\'à l\'arrivée de celle-ci', () => {
    // Échec trouvé dans le cache : l'image est déjà « complète » à la pose
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    shrinking.originals.set(src('a'), 'http://192.0.2.41/a.jpg');
    const row = placedRow();
    row.fill(data([item('a')]), true);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe('http://192.0.2.41/a.jpg');
    expect(img.style.visibility).toBe('hidden');
    img.dispatchEvent(new Event('load'));
    expect(img.style.visibility).toBe('');
    row.destroy();
  });

  it('affiche arrivée pendant que sa carte était hors de la rangée : visible quand la carte revient', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    const row = placedRow();
    row.fill(data([item('a')]), true);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    expect(img.style.visibility).toBe('hidden');
    // Arrivée sans que la rangée reçoive son `load`, puis même catégorie remplie de nouveau
    complete.mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(185);
    row.fill(data([item('a')]), false);
    expect(img.getAttribute('src')).toBe(src('a'));
    expect(img.style.visibility).toBe('');
    row.destroy();
  });

  it('témoin des mesures : l\'image d\'avant, gardée vide dans la carte en attente et montrée pendant son chargement', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    setBareWaitingCard(false);
    const row = placedRow();
    placeCards([0, 0]);
    row.fill(data([item('old')]), true);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    expect(img.style.visibility).toBe('');
    expect(img.alt).toBe('old');
    noteArrow();
    row.fill(data([item('new')]), true);
    expect(row.root.querySelector('.carousel-card img')).toBe(img);
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.alt).toBe('');
    row.destroy();
  });

  it('affiches réduites annoncées ensemble : positions lues en une passe, avant toute pose, puis cartes remplies', async () => {
    const row = placedRow();
    shrinking.waiting.add(src('a')).add(src('b')).add(src('c'));
    row.fill(data([item('a'), item('b'), item('c')]), true);
    const seen: number[] = [];
    lefts = [0, 300, 3 * innerWidth];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      seen.push(row.root.querySelectorAll('.carousel-card img[src]').length);
      const slot = this.closest('[data-index]');
      const left = slot ? lefts[Number(slot.getAttribute('data-index'))] ?? 0 : 0;
      return { left, right: left + 200, top: 0, bottom: 300, width: 200, height: 300, x: left, y: 0, toJSON: () => ({}) };
    });
    // Comme tvPoster.ts : tout le lot dans la même tâche
    shrinking.waiting.clear();
    for (const callback of [...shrinking.settle.values()]) callback();
    await Promise.resolve();
    expect(seen).toEqual([0, 0, 0]);
    expect(posters(row.root)).toEqual([src('a'), src('b'), null]);
    row.destroy();
  });

  it('affiche en échec pendant que sa carte était hors de la rangée : l\'adresse d\'origine, sinon le titre, au retour', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    shrinking.originals.set(src('a'), 'http://192.0.2.41/a.jpg');
    const row = placedRow();
    row.fill(data([item('a'), item('b')]), true);
    // Les deux échouent sans que la rangée reçoive leur `error` (image complète, sans taille)
    complete.mockReturnValue(true);
    row.fill(data([item('a'), item('b')]), false);
    const img = row.root.querySelector<HTMLImageElement>('.carousel-card img')!;
    expect(img.getAttribute('src')).toBe('http://192.0.2.41/a.jpg');
    const second = row.root.querySelectorAll('.carousel-card')[1];
    expect(second.querySelector('img')).toBeNull();
    expect(second.querySelector('.card-placeholder-title')!.textContent).toBe('b');
    row.destroy();
  });
});

describe('tranche de cartes suivante', () => {
  it('rangée recyclée avant l\'image de la tranche demandée : la nouvelle catégorie repart de sa première tranche', () => {
    const items = (prefix: string) => Array.from({ length: 30 }, (_, index) => item(`${prefix}${index}`));
    const row = placedRow();
    row.fill(data(items('a')), true);
    // Sélection près de la dernière carte construite : la tranche suivante est demandée pour l'image suivante
    row.root.querySelectorAll<HTMLElement>('.carousel-card')[10].focus();
    row.fill(data(items('b')), true);
    vi.advanceTimersByTime(50);
    expect(row.root.querySelectorAll('.carousel-card')).toHaveLength(12);
    row.destroy();
  });
});
