/**
 * Carte d'une rangée recyclée dont l'affiche du fournisseur est en cours de réduction : vide d'ici là (sans l'affiche
 * de la catégorie d'avant), remplie dès qu'elle est prête, jamais remplie d'une affiche qui n'est plus la sienne.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CarouselItem } from '../../../Lists/CarouselCard';

vi.mock('../../../../hooks/useWatchlistKeys', () => ({
  currentWatchlistKeys: () => null,
  onWatchlistKeys: () => () => {},
}));
vi.mock('../../../../services/watchlistActions', () => ({ toggleWatchlistOrNotify: vi.fn() }));

const posters = vi.hoisted(() => ({
  ready: new Set<string>(),
  waits: new Map<string, () => void>(),
  /** Adresse d'origine d'une affiche réduite (fallbackPosterSrc) */
  originals: new Map<string, string>(),
}));
vi.mock('../../../Lists/tvPoster', () => ({
  tvPosterSrc: (url: string) => (posters.ready.has(url) ? `nyxposter://localhost/185?u=${url}` : null),
  onPosterSettled: (url: string, callback: () => void) => {
    posters.waits.set(url, callback);
    return () => posters.waits.delete(url);
  },
  fallbackPosterSrc: (src: string) => posters.originals.get(src) ?? null,
}));

import { createRailRow } from '../railRow';

const item = (name: string): CarouselItem => ({ id: name, title: name, image: `http://192.0.2.40/${name}.jpg`, mediaType: 'movie', onClick: () => {} });
const data = (items: CarouselItem[]) => ({ title: 'Rangée', items, watchlistLabel: 'Ajouter à ma liste' });
const posterOf = (root: HTMLElement) => root.querySelector('.carousel-card img') as HTMLImageElement;

describe('railRow, affiche en cours de réduction', () => {
  beforeEach(() => {
    posters.ready.clear();
    posters.waits.clear();
    posters.originals.clear();
  });

  it('la carte reste vide puis montre l\'affiche dès qu\'elle est prête', async () => {
    const row = createRailRow();
    row.fill(data([item('a')]), true);
    // Case grise : image sans adresse (cachée par tv.css), sans bascule d'opacité
    const img = posterOf(row.root);
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.style.opacity).toBe('');

    posters.ready.add('http://192.0.2.40/a.jpg');
    posters.waits.get('http://192.0.2.40/a.jpg')!();
    // Affiches prêtes remplies ensemble, juste après la tâche qui les annonce
    await Promise.resolve();
    expect(posterOf(row.root).getAttribute('src')).toBe('nyxposter://localhost/185?u=http://192.0.2.40/a.jpg');
    row.destroy();
  });

  it('une carte recyclée n\'attend plus l\'affiche de son ancienne catégorie', () => {
    const row = createRailRow();
    posters.ready.add('http://192.0.2.40/old.jpg');
    row.fill(data([item('old')]), true);
    row.fill(data([item('new')]), true);
    // L'ancienne affiche n'est plus montrée en attendant la nouvelle
    expect(posterOf(row.root).hasAttribute('src')).toBe(false);
    expect(posters.waits.has('http://192.0.2.40/new.jpg')).toBe(true);

    row.fill(data([item('other')]), true);
    expect(posters.waits.has('http://192.0.2.40/new.jpg')).toBe(false);
    row.destroy();
    expect(posters.waits.size).toBe(0);
  });

  it('une affiche réduite en échec reprend l\'adresse d\'origine, puis le titre si elle échoue aussi', () => {
    const row = createRailRow();
    const original = 'http://192.0.2.40/a.jpg';
    const shrunk = `nyxposter://localhost/185?u=${original}`;
    posters.ready.add(original);
    posters.originals.set(shrunk, original);
    row.fill(data([item('a')]), true);
    const img = posterOf(row.root);
    expect(img.getAttribute('src')).toBe(shrunk);

    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(original);
    expect(row.root.querySelector('.card-placeholder-title')).toBeNull();

    img.dispatchEvent(new Event('error'));
    expect(row.root.querySelector('.carousel-card img')).toBeNull();
    expect(row.root.querySelector('.card-placeholder-title')!.textContent).toBe('a');
    row.destroy();
  });
});

describe('railRow, carte recyclée dont l\'affiche est prête', () => {
  beforeEach(() => {
    posters.ready.clear();
    posters.waits.clear();
    posters.originals.clear();
  });

  it('l\'ancienne affiche est retirée avant de poser la nouvelle, sans bascule d\'opacité', () => {
    const row = createRailRow();
    posters.ready.add('http://192.0.2.40/old.jpg');
    posters.ready.add('http://192.0.2.40/new.jpg');
    row.fill(data([item('old')]), true);
    const img = posterOf(row.root);
    const changes = new MutationObserver(() => {});
    changes.observe(img, { attributes: true, attributeOldValue: true, attributeFilter: ['src', 'style'] });

    row.fill(data([item('new')]), true);
    expect(img.getAttribute('src')).toBe('nyxposter://localhost/185?u=http://192.0.2.40/new.jpg');
    const records = changes.takeRecords();
    changes.disconnect();
    // L'ancienne adresse est retirée (case vide), puis la nouvelle est posée sur une image sans adresse
    expect(records.filter((r) => r.attributeName === 'src').map((r) => r.oldValue)).toEqual([
      'nyxposter://localhost/185?u=http://192.0.2.40/old.jpg',
      null,
    ]);
    expect(records.filter((r) => r.attributeName === 'style')).toEqual([]);
    img.dispatchEvent(new Event('load'));
    expect(img.style.opacity).toBe('');
    row.destroy();
  });

  it('même affiche : rien n\'est retiré ni reposé', () => {
    const row = createRailRow();
    posters.ready.add('http://192.0.2.40/a.jpg');
    row.fill(data([item('a')]), true);
    const img = posterOf(row.root);
    const remove = vi.spyOn(img, 'removeAttribute');
    row.fill(data([{ ...item('a'), title: 'a bis' }]), true);
    expect(remove).not.toHaveBeenCalledWith('src');
    expect(img.getAttribute('src')).toBe('nyxposter://localhost/185?u=http://192.0.2.40/a.jpg');
    row.destroy();
  });
});
