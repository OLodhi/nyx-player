/**
 * Rail recyclé de l'accueil Films / Séries TV : rangées construites d'avance d'après la sélection, une par image,
 * places réutilisées d'une catégorie à l'autre, mémoire bornée, et rangées écrites sans React qui se comportent comme
 * les rangées React (repères, gestes, Ma liste).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRail, setLegacyRail, type Rail, type RailSource } from '../rail';
import { RAIL_WINDOW, WIDE_RAIL_WINDOW } from '../railWindow';
import { CARD_BATCH } from '../railRow';

const MAX_MOUNTED = RAIL_WINDOW.max;
import { rowContentOf, rowPlaceOf } from '../../../../utils/spatialNavigation/rowHost';
import { animateScrollTo, cancelAllScrolls, isScrollAnimating } from '../../../../utils/spatialNavigation/scrollAnimator';
import { REST_DELAY_MS, noteArrow } from '../../../../utils/spatialNavigation/navigationRest';
import { remember, rememberedInRow } from '../../../../utils/spatialNavigation/focusMemory';
import { setTvMode } from '../../../../utils/platform';
import type { CarouselItem } from '../../../Lists/CarouselCard';
import { watchlistItemKey } from '../../../../services/watchlistHydration';

const keys = vi.hoisted(() => ({ current: null as Set<string> | null, listeners: new Set<() => void>() }));
vi.mock('../../../../hooks/useWatchlistKeys', () => ({
  currentWatchlistKeys: () => keys.current,
  onWatchlistKeys: (listener: () => void) => { keys.listeners.add(listener); return () => keys.listeners.delete(listener); },
}));
const toggle = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: toggle }));
const prefetch = vi.hoisted(() => vi.fn());
vi.mock('../../../Lists/tvPoster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../Lists/tvPoster')>()),
  prefetchShrunkPosters: prefetch,
}));

/** Observateur d'intersection simulé : `show(places)` les signale près de l'écran */
let intersect: ((targets: Element[]) => void) | null = null;
class FakeIntersection {
  constructor(callback: IntersectionObserverCallback) {
    intersect = (targets) => callback(targets.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry), this as unknown as IntersectionObserver);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
class FakeResize {
  observe() {}
  disconnect() {}
}

const COUNT = 30;
const categories = Array.from({ length: COUNT }, (_, i) => `cat-${i}`);
const clicks: string[] = [];

function itemsOf(key: string, label = ''): CarouselItem[] {
  const items: CarouselItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `${key}-${i}`,
    title: `${label}${key} film ${i}`,
    image: `https://image.tmdb.org/t/p/w342/${key}-${i}.jpg`,
    mediaType: 'movie',
    tmdbId: 100 + i,
    streamId: i,
    onClick: () => clicks.push(`${key}-${i}`),
  }));
  items.push({ id: `see-all-${key}`, title: 'Voir tout', image: '', isActionButton: true, onClick: () => clicks.push(`see-all-${key}`) });
  return items;
}

const sourceWith = (label = ''): RailSource => (key) => ({ title: `${label}${key}`, items: itemsOf(key, label), watchlistLabel: 'Ajouter à ma liste' });

let page: HTMLDivElement;
let list: HTMLDivElement;
let rail: Rail;

function places(): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('.rail-place'));
}

/** Titre affiché pour l'emplacement de la catégorie n° `index`, ou null s'il est gris */
function shown(index: number): string | null {
  const content = rowContentOf(places()[index]);
  return content === places()[index] ? null : content.querySelector('.iptv-category-title')?.textContent ?? null;
}

/** Sélectionne une carte de la catégorie n° `index` (affichée) */
function select(index: number, card = 0): HTMLElement {
  const target = rowContentOf(places()[index]).querySelectorAll<HTMLElement>('[data-testid="carousel-card"]')[card];
  target.focus();
  // Ce que fait la navigation à chaque déplacement (mémoire de la carte quittée, par étage)
  remember(target);
  return target;
}

const frames = (n: number) => { for (let i = 0; i < n; i += 1) vi.advanceTimersByTime(16); };
const builtRows = () => list.querySelectorAll('.rail-slot').length;

let clock = Date.UTC(2030, 0, 1);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] });
  // Horloge toujours en avant d'un test à l'autre : la dernière flèche d'un test précédent est loin
  clock += 60_000;
  vi.setSystemTime(clock);
  vi.stubGlobal('IntersectionObserver', FakeIntersection);
  vi.stubGlobal('ResizeObserver', FakeResize);
  setTvMode(true);
  clicks.length = 0;
  keys.current = null;
  prefetch.mockClear();
  document.body.innerHTML = '';
  page = document.createElement('div');
  page.style.overflowY = 'auto';
  list = document.createElement('div');
  page.appendChild(list);
  document.body.appendChild(page);
  rail = createRail(list);
  rail.setSource(sourceWith());
  rail.setRows(categories);
});

afterEach(() => {
  setLegacyRail(false);
  rail.destroy();
  cancelAllScrolls();
  setTvMode(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rail recyclé', () => {
  it('un emplacement par catégorie, dans l\'ordre, gris tant que rien n\'y est construit', () => {
    expect(places()).toHaveLength(COUNT);
    expect(places().every((place) => place.classList.contains('lazy-category'))).toBe(true);
    expect(shown(0)).toBeNull();
    expect(builtRows()).toBe(0);
  });

  it('premier affichage : les emplacements près de l\'écran sont construits, un par image', () => {
    intersect!(places().slice(0, 3));
    expect(builtRows()).toBe(0);
    frames(1);
    expect(shown(0)).toBe('cat-0');
    expect(shown(1)).toBeNull();
    frames(2);
    expect([shown(0), shown(1), shown(2)]).toEqual(['cat-0', 'cat-1', 'cat-2']);
  });

  it('une rangée a les repères et les cartes de la rangée React : titre, onze cartes, « Voir tout », calque', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const row = rowContentOf(places()[0]);
    expect(row.querySelector('[data-testid="iptv-category"]')).toHaveAttribute('data-see-all', 'true');
    expect(row.querySelector('[data-nav-align]')).not.toBeNull();
    expect(row.querySelector('[data-testid="carousel-row-track"]')).toHaveAttribute('data-nav-row');
    const cards = row.querySelectorAll('[data-testid="carousel-card"]');
    expect(cards).toHaveLength(11);
    expect(cards[0].querySelector('img')).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/cat-0-0.jpg');
    expect(cards[0]).toHaveAttribute('data-nav-longpress');
    expect(cards[10]).toHaveClass('action-button');
    expect(row.querySelector('[data-testid="carousel-card-layer"]')).not.toBeNull();
    // La navigation retrouve l'emplacement d'une carte affichée dans le calque
    expect(rowPlaceOf(cards[3], '.rail-place')).toBe(places()[0]);
  });

  it('OK, clic et appui long : la carte ouvre son titre, l\'appui long change Ma liste', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const card = select(0, 2);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    card.click();
    expect(clicks).toEqual(['cat-0-2', 'cat-0-2']);
    card.dispatchEvent(new CustomEvent('nyx:longpress'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('Ma liste changée ailleurs : l\'état des cartes suit', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const cards = rowContentOf(places()[0]).querySelectorAll('[data-testid="carousel-card"]');
    expect(cards[0]).not.toHaveClass('carousel-card--in-watchlist');
    keys.current = new Set([watchlistItemKey(0, 102, 'movie')!]);
    keys.listeners.forEach((listener) => listener());
    const marked = Array.from(cards).filter((card) => card.classList.contains('carousel-card--in-watchlist'));
    expect(marked).toEqual([cards[2]]);
  });

  it('sélection en descente : une rangée d\'avance et une derrière, une par image', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    select(0);
    frames(1);
    expect(shown(1)).toBe('cat-1');
    frames(5);
    expect(shown(2)).toBeNull();
    select(1);
    frames(1);
    expect(shown(2)).toBe('cat-2');
    frames(5);
    expect(shown(3)).toBeNull();
  });

  it('longue descente : quatre rangées montées au plus, places recyclées, mémoire bornée', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    for (let index = 0; index < 20; index += 1) {
      select(index);
      frames(4);
    }
    // Rangées autour de la sélection prêtes, devant comme derrière
    expect([shown(19), shown(20), shown(18)]).toEqual(['cat-19', 'cat-20', 'cat-18']);
    // Plafond : jamais plus de places que de rangées montées permises
    expect(builtRows()).toBeLessThanOrEqual(MAX_MOUNTED);
    expect(list.querySelectorAll('[data-testid="carousel-card"]').length).toBeLessThanOrEqual(MAX_MOUNTED * CARD_BATCH);
  });

  it('ancien comportement (mesures de comparaison) : fenêtre large, affiches gardées au repos', () => {
    rail.destroy();
    setLegacyRail(true);
    rail = createRail(list);
    rail.setSource(sourceWith());
    rail.setRows(categories);
    intersect!(places().slice(0, 1));
    frames(1);
    for (let index = 0; index < 8; index += 1) {
      select(index);
      frames(4);
    }
    expect(shown(9)).toBe('cat-9');
    vi.advanceTimersByTime(REST_DELAY_MS + 500);
    expect(builtRows()).toBeLessThanOrEqual(WIDE_RAIL_WINDOW.max);
    for (const slot of list.querySelectorAll('.rail-slot')) expect(slot.querySelector('.carousel-card img[src]')).not.toBeNull();
  });

  it('place recyclée : mêmes éléments, nouvelle catégorie, et la nouvelle affiche à la place de l\'ancienne, sans bascule d\'opacité', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const firstCard = rowContentOf(places()[0]).querySelector<HTMLElement>('[data-testid="carousel-card"]')!;
    for (let index = 0; index < 12; index += 1) {
      select(index);
      frames(4);
    }
    const reused = places().findIndex((place, index) => index > 0 && rowContentOf(place).contains(firstCard));
    expect(reused).toBeGreaterThan(0);
    expect(shown(reused)).toBe(`cat-${reused}`);
    const img = firstCard.querySelector('img')!;
    expect(img).toHaveAttribute('src', `https://image.tmdb.org/t/p/w185/cat-${reused}-0.jpg`);
    expect(img.style.opacity).toBe('');
  });

  it('retour en haut de page, sélection hors du rail : les emplacements revenus à l\'écran sont reconstruits', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    for (let index = 0; index < 12; index += 1) {
      select(index);
      frames(4);
    }
    vi.advanceTimersByTime(REST_DELAY_MS + 100);
    expect(shown(0)).not.toBe('cat-0');
    // Onglets au-dessus des rangées
    const tab = document.createElement('button');
    document.body.appendChild(tab);
    tab.focus();
    intersect!(places().slice(0, 3));
    frames(3);
    expect([shown(0), shown(1), shown(2)]).toEqual(['cat-0', 'cat-1', 'cat-2']);
    expect(builtRows()).toBeLessThanOrEqual(MAX_MOUNTED);
  });

  it('fiche ouverte avant le repos (OK juste après une flèche) : les rangées autour de la sélection restent montées', () => {
    // Premier affichage, sélection sur les onglets : les rangées du haut sont construites par l'observateur
    intersect!(places().slice(0, 3));
    frames(3);
    for (let index = 0; index < 9; index += 1) {
      noteArrow();
      select(index);
      frames(4);
    }
    // OK sur la rangée 8 moins de 600 ms après la dernière flèche : la fiche s'ouvre par-dessus l'accueil
    const detail = document.createElement('button');
    document.body.appendChild(detail);
    detail.focus();
    rail.setCovered(true);
    vi.advanceTimersByTime(REST_DELAY_MS + 100);
    // Pendant la fiche, une rangée du haut revient près de l'écran (Ma liste ajoutée, reprise mise à jour)
    intersect!(places().slice(0, 1));
    frames(4);
    expect([shown(7), shown(8), shown(9)]).toEqual(['cat-7', 'cat-8', 'cat-9']);
  });

  it('catégorie retirée (masquée) : son emplacement part, sa place est rangée hors de portée', () => {
    intersect!(places().slice(0, 2));
    frames(2);
    const removed = rowContentOf(places()[1]) as HTMLElement;
    rail.setRows(categories.filter((key) => key !== 'cat-1'));
    expect(places()).toHaveLength(COUNT - 1);
    expect(removed.hidden).toBe(true);
    expect(rowPlaceOf(removed.querySelector('[data-testid="carousel-card"]')!, '.rail-place')).toBeNull();
    expect(shown(0)).toBe('cat-0');
  });

  // Le compositeur joue la descente vers une cible posée au départ : un emplacement ajouté ou retiré au-dessus en plein
  // mouvement la fausserait
  it('catégorie qui apparaît ou disparaît pendant un défilement : appliqué une fois le défilement arrivé', () => {
    Object.defineProperty(page, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(page, 'clientHeight', { value: 720, configurable: true });
    let position = 0;
    Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    animateScrollTo(page, { top: 600 });
    expect(isScrollAnimating()).toBe(true);

    const before = places();
    rail.setRows(['watchlist', ...categories]);
    // Seule la dernière liste compte
    rail.setRows(['watchlist', ...categories.slice(1)]);
    // Mêmes emplacements, pas un seul ajouté ni retiré
    expect(places().length).toBe(before.length);
    expect(places().every((place, index) => place === before[index])).toBe(true);
    for (let i = 0; i < 300 && isScrollAnimating(); i += 1) frames(1);
    expect(isScrollAnimating()).toBe(false);
    expect(places()).toHaveLength(COUNT);
    // « watchlist » en tête, « cat-0 » parti
    expect(places()[0]).not.toBe(before[0]);
    expect(places()[1]).toBe(before[1]);
    intersect!(places().slice(0, 1));
    frames(1);
    expect(shown(0)).toBe('watchlist');
    expect(shown(1)).toBeNull();
  });

  it('rail créé en plein défilement : ses premières catégories sont posées tout de suite', () => {
    Object.defineProperty(page, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(page, 'clientHeight', { value: 720, configurable: true });
    let position = 0;
    Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    rail.destroy();
    rail = createRail(list);
    rail.setSource(sourceWith());
    animateScrollTo(page, { top: 600 });
    expect(isScrollAnimating()).toBe(true);
    rail.setRows(categories);
    expect(places()).toHaveLength(COUNT);
  });

  it('sans défilement en cours, les catégories sont appliquées tout de suite', () => {
    rail.setRows(['watchlist', ...categories]);
    expect(places()).toHaveLength(COUNT + 1);
    rail.setRows(categories);
    expect(places()).toHaveLength(COUNT);
  });

  it('nouvelles données (synchro) : les rangées montées sont remplies de nouveau', () => {
    intersect!(places().slice(0, 2));
    frames(2);
    rail.setSource(sourceWith('Nouveau '));
    expect(shown(0)).toBe('Nouveau cat-0');
    expect(shown(1)).toBe('Nouveau cat-1');
  });

  it('synchro (mêmes catégories relues) : la rangée garde sa position et sa carte retenue ; recyclée, elle repart du début', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const track = rowContentOf(places()[0]).querySelector<HTMLElement>('[data-nav-row]')!;
    track.scrollLeft = 900;
    track.dispatchEvent(new Event('scroll'));
    select(0, 6);
    rail.setSource(sourceWith('Nouveau '));
    expect(track.scrollLeft).toBe(900);
    expect(rememberedInRow(track)).toBeDefined();
    for (let index = 0; index < 12; index += 1) {
      select(index);
      frames(4);
    }
    const reused = places().findIndex((place, index) => index > 0 && rowContentOf(place).contains(track));
    expect(reused).toBeGreaterThan(0);
    expect(track.scrollLeft).toBe(0);
  });

  it('affiche introuvable : le titre la remplace, et reste après une synchro qui redonne la même adresse', () => {
    intersect!(places().slice(0, 1));
    frames(1);
    const card = rowContentOf(places()[0]).querySelector<HTMLElement>('[data-testid="carousel-card"]')!;
    card.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.card-placeholder-title')?.textContent).toBe('cat-0 film 0');
    rail.setSource(sourceWith());
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.card-placeholder-title')).not.toBeNull();
  });

  it('défilement vertical de la page joué par le compositeur tant que le rail est là', () => {
    vi.stubGlobal('CSS', { supports: (property: string) => property === 'translate' });
    page.animate = (() => ({}) as Animation) as typeof page.animate;
    list.animate = (() => ({ currentTime: 0, cancel() {} }) as unknown as Animation) as typeof list.animate;
    Object.defineProperty(page, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(page, 'clientHeight', { value: 720 });
    let position = 0;
    Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    animateScrollTo(page, { top: 600 });
    expect(page.scrollTop).toBe(600);
    rail.destroy();
    animateScrollTo(page, { top: 0 });
    animateScrollTo(page, { top: 900 });
    expect(page.scrollTop).toBeLessThan(900);
    rail = createRail(list);
  });

  it('accueil quitté : emplacements et rangées retirés de la page', () => {
    intersect!(places().slice(0, 2));
    frames(2);
    rail.destroy();
    expect(list.children).toHaveLength(0);
    rail = createRail(list);
  });

  it('affiches des 15 premières rangées préparées d\'avance, une fois les données posées ; liste vidée à la sortie', () => {
    // Source puis rangées posées dans le même instant : une seule liste, 300 ms après le dernier changement
    vi.advanceTimersByTime(299);
    expect(prefetch).not.toHaveBeenCalled();
    rail.setRows(categories);
    vi.advanceTimersByTime(299);
    expect(prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(prefetch).toHaveBeenCalledTimes(1);
    const urls = prefetch.mock.calls[0][0] as string[];
    expect(urls).toHaveLength(15 * 11);
    expect(urls[0]).toBe(itemsOf('cat-0')[0].image);
    expect(urls).not.toContain(itemsOf('cat-15')[0].image);

    rail.destroy();
    expect(prefetch).toHaveBeenLastCalledWith([]);
    vi.advanceTimersByTime(300);
    expect(prefetch).toHaveBeenCalledTimes(2);
    rail = createRail(list);
  });
});
