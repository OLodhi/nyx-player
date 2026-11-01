/**
 * Places du rail : au repos, une place libre vide ses affiches ; si elle resert à la même catégorie, elle les reprend
 * sans repartir de sa première carte. Une place montée garde les siennes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rows = vi.hoisted(() => [] as Array<{ fill: ReturnType<typeof vi.fn>; dropImages: ReturnType<typeof vi.fn> }>);
vi.mock('../railRow', () => ({
  createRailRow: () => {
    const row = { root: document.createElement('div'), fill: vi.fn(), dropImages: vi.fn(), destroy: vi.fn() };
    rows.push(row);
    return row;
  },
}));

import { createRailSlots, type RailSlots } from '../railSlots';

class FakeResize {
  observe() {}
  disconnect() {}
}

let slots: RailSlots;
const placeOfKey = new Map<string, HTMLElement>();
const data = (key: string) => ({ title: key, items: [], watchlistLabel: 'Ajouter à ma liste' });

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeResize);
  rows.length = 0;
  placeOfKey.clear();
  document.body.innerHTML = '';
  const list = document.createElement('div');
  document.body.appendChild(list);
  for (const key of ['a', 'b', 'c']) {
    const place = document.createElement('div');
    list.appendChild(place);
    placeOfKey.set(key, place);
  }
  slots = createRailSlots(list, { placeOf: (key) => placeOfKey.get(key), indexOf: (key) => ['a', 'b', 'c'].indexOf(key) });
  slots.setSource(data);
});

afterEach(() => {
  slots.destroy();
  vi.unstubAllGlobals();
});

describe('affiches des places libres', () => {
  it('une place libre vide ses affiches, une place montée les garde', () => {
    slots.assign('a');
    slots.assign('b');
    slots.release('a');
    slots.dropIdleImages();
    expect(rows[0].dropImages).toHaveBeenCalledTimes(1);
    expect(rows[1].dropImages).not.toHaveBeenCalled();
    // Déjà vidée : rien de plus
    slots.dropIdleImages();
    expect(rows[0].dropImages).toHaveBeenCalledTimes(1);
  });

  it('la même catégorie revient : la place reprend ses affiches sans repartir de sa première carte', () => {
    slots.assign('a');
    expect(rows[0].fill).toHaveBeenLastCalledWith(data('a'), true);
    slots.release('a');
    slots.dropIdleImages();
    slots.assign('a');
    expect(rows[0].fill).toHaveBeenCalledTimes(2);
    expect(rows[0].fill).toHaveBeenLastCalledWith(data('a'), false);
  });

  it('catégorie disparue (accueil changé) : sa place, libérée, vide ses affiches', () => {
    slots.assign('a');
    placeOfKey.delete('a');
    slots.relayout();
    expect(rows[0].dropImages).toHaveBeenCalledTimes(1);
  });

  it('une autre catégorie prend la place vidée : elle repart de sa première carte', () => {
    slots.assign('a');
    slots.release('a');
    slots.dropIdleImages();
    slots.assign('c');
    expect(rows).toHaveLength(1);
    expect(rows[0].fill).toHaveBeenLastCalledWith(data('c'), true);
  });
});

describe('remplissage d\'une place montée', () => {
  it('nouvelle version des données : seule la catégorie dont l\'objet a changé est remplie de nouveau', () => {
    const a = data('a');
    const b = data('b');
    slots.setSource((key) => (key === 'a' ? a : b));
    slots.assign('a');
    slots.assign('b');
    expect(rows[0].fill).toHaveBeenCalledTimes(1);
    expect(rows[1].fill).toHaveBeenCalledTimes(1);

    // Ma liste change : seule la rangée « b » reçoit un nouvel objet
    const b2 = data('b');
    slots.setSource((key) => (key === 'a' ? a : b2));
    expect(rows[0].fill).toHaveBeenCalledTimes(1);
    expect(rows[1].fill).toHaveBeenCalledTimes(2);
    expect(rows[1].fill).toHaveBeenLastCalledWith(b2, false);
  });

  it('même objet, mais affiches vidées au repos : la place est remplie de nouveau en revenant', () => {
    const a = data('a');
    slots.setSource(() => a);
    slots.assign('a');
    slots.release('a');
    slots.dropIdleImages();
    slots.assign('a');
    expect(rows[0].fill).toHaveBeenCalledTimes(2);
    expect(rows[0].fill).toHaveBeenLastCalledWith(a, false);
  });

  it('même objet pour une autre catégorie qui prend la place : remplie', () => {
    const shared = data('x');
    slots.setSource(() => shared);
    slots.assign('a');
    slots.release('a');
    slots.assign('c');
    expect(rows).toHaveLength(1);
    expect(rows[0].fill).toHaveBeenCalledTimes(2);
    expect(rows[0].fill).toHaveBeenLastCalledWith(shared, true);
  });
});

describe('hauteur réservée d\'une rangée', () => {
  const ready = { resolve: () => {} };
  let height = '501.39px';
  const list = () => document.body.firstElementChild as HTMLElement;

  beforeEach(() => {
    height = '501.39px';
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ height } as CSSStyleDeclaration));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'fonts');
  });

  const stubFonts = (status: 'loading' | 'loaded') => {
    const promise = new Promise<void>((resolve) => { ready.resolve = resolve; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status, ready: promise } });
  };

  it('mesurée avant le chargement des polices : mesurée de nouveau une fois les polices prêtes', async () => {
    stubFonts('loading');
    slots.assign('a');
    expect(list().style.getPropertyValue('--rail-row-height')).toBe('501.39px');
    // La police de l'appli arrive : la rangée grandit de 3 px
    height = '504.39px';
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(list().style.getPropertyValue('--rail-row-height')).toBe('504.39px');
  });

  it('polices déjà prêtes : une seule mesure', async () => {
    stubFonts('loaded');
    slots.assign('a');
    height = '504.39px';
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(list().style.getPropertyValue('--rail-row-height')).toBe('501.39px');
  });

  it('rail détruit avant les polices : rien n\'est mesuré après', async () => {
    stubFonts('loading');
    slots.assign('a');
    const element = list();
    slots.destroy();
    element.style.setProperty('--rail-row-height', 'témoin');
    height = '504.39px';
    ready.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(element.style.getPropertyValue('--rail-row-height')).toBe('témoin');
  });
});
