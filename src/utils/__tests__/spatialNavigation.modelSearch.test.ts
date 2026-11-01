/**
 * Recherche sans mesure (rail recyclé de l'accueil Films / Séries TV) : sur un accueil simulé, depuis chaque carte et
 * dans chaque direction, la carte choisie doit être exactement celle de la recherche habituelle, qui mesure tout
 * l'écran.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { setTvMode } from '../platform';
import { findNextFocusable } from '../spatialNavigation';
import { modelTarget } from '../spatialNavigation/modelSearch';
import { linkRowContent } from '../spatialNavigation/rowHost';
import type { Direction } from '../spatialNavigation/dom';

const SAFE_LEFT = 60;
const CARD_W = 150;
const CARD_H = 225;
const ROW_H = 330;

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect;
}

interface RowSpec {
  /** Cartes montées (plage du virtualiseur) */
  from: number;
  to: number;
  scrollLeft: number;
  gap?: number;
  /** Rangée des suggestions (React, dans son emplacement) plutôt que catégorie du rail */
  suggestion?: boolean;
  /** Emplacement encore gris : ni piste ni cartes */
  gray?: boolean;
}

/**
 * Accueil : bannière (boutons), rangées alignées, barre latérale. Positions calculées comme à l'écran. Rail : les
 * rangées sont dans un calque après les emplacements, reliées à leur emplacement, comme dans l'application.
 */
function home(specs: RowSpec[]) {
  document.body.innerHTML = '';
  const sidebar = document.createElement('nav');
  sidebar.setAttribute('data-nav-zone', 'sidebar');
  const icon = document.createElement('button');
  icon.getBoundingClientRect = () => rect(0, 100, 40, 40);
  sidebar.append(icon);
  document.body.append(sidebar);

  const hero = document.createElement('div');
  hero.setAttribute('data-nav-row', '');
  for (const x of [SAFE_LEFT, SAFE_LEFT + 160]) {
    const b = document.createElement('button');
    b.getBoundingClientRect = () => rect(x, 200, 140, 50);
    hero.append(b);
  }
  document.body.append(hero);

  const list = document.createElement('div');
  const layer = document.createElement('div');
  layer.className = 'rail-layer';
  document.body.append(list);
  const cards: HTMLElement[][] = [];
  specs.forEach((spec, r) => {
    const top = 400 + r * ROW_H;
    const slot = document.createElement('div');
    let aligned = slot;
    if (spec.suggestion) {
      slot.className = 'virtual-dashboard-row';
    } else {
      slot.className = 'lazy-category rail-place';
      aligned = document.createElement('div');
      aligned.className = 'iptv-category-section';
      const content = document.createElement('div');
      content.className = 'rail-slot';
      content.append(aligned);
      if (!spec.gray) {
        layer.append(content);
        linkRowContent(slot, content);
      }
    }
    list.append(slot);
    const row: HTMLElement[] = [];
    cards.push(row);
    if (spec.gray) return;
    aligned.setAttribute('data-nav-align', '');
    const container = document.createElement('div');
    container.className = 'content-carousel-container';
    const track = document.createElement('div');
    track.setAttribute('data-nav-row', '');
    Object.defineProperty(track, 'scrollLeft', { value: spec.scrollLeft, configurable: true });
    const inner = document.createElement('div');
    track.append(inner);
    container.append(track);
    aligned.append(container);
    const step = CARD_W + (spec.gap ?? 28);
    for (let i = spec.from; i <= spec.to; i++) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-index', String(i));
      wrapper.style.width = `${CARD_W}px`;
      wrapper.style.transform = `translateX(${i * step}px)`;
      const card = document.createElement('div');
      card.className = 'carousel-card';
      card.tabIndex = 0;
      card.getBoundingClientRect = () => rect(SAFE_LEFT + i * step - spec.scrollLeft, top, CARD_W, CARD_H);
      wrapper.append(card);
      inner.append(wrapper);
      row.push(card);
    }
  });
  list.append(layer);
  return { cards, hero, icon };
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

// jsdom recalcule tous les styles à chaque lecture (plusieurs dizaines de ms par recherche complète) ; ici la page ne
// change pas pendant une comparaison, donc un style lu une fois reste juste (tant qu'un test ne modifie ni styles ni
// classes entre deux recherches).
const readStyle = window.getComputedStyle.bind(window);
let styles = new WeakMap<Element, CSSStyleDeclaration>();
function cachedStyle(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  if (pseudo) return readStyle(el, pseudo);
  let style = styles.get(el);
  if (!style) {
    style = readStyle(el);
    styles.set(el, style);
  }
  return style;
}

beforeEach(() => {
  setTvMode(true);
  styles = new WeakMap();
  window.getComputedStyle = cachedStyle as typeof window.getComputedStyle;
});

afterEach(() => {
  window.getComputedStyle = readStyle;
  setTvMode(false);
  document.body.innerHTML = '';
});

/** La recherche habituelle seule : le raccourci ne reconnaît plus les emplacements du rail. */
function withoutShortcut<T>(run: () => T): T {
  const places = Array.from(document.querySelectorAll('.rail-place'));
  places.forEach((place) => place.classList.remove('rail-place'));
  try {
    return run();
  } finally {
    places.forEach((place) => place.classList.add('rail-place'));
  }
}

/** Compare, depuis chaque carte et dans chaque direction, les deux recherches ; renvoie le nombre de cas sans mesure. */
function compareAll(cards: HTMLElement[][]): number {
  let handled = 0;
  for (const row of cards) {
    for (const card of row) {
      for (const direction of DIRECTIONS) {
        const expected = withoutShortcut(() => findNextFocusable(card, direction));
        const model = modelTarget(card, direction);
        if (model) {
          handled += 1;
          expect({ from: card.parentElement?.dataset.index, direction, got: model.parentElement?.dataset.index }).toEqual({
            from: card.parentElement?.dataset.index,
            direction,
            got: expected?.parentElement?.dataset.index,
          });
          expect(model).toBe(expected);
        }
        expect(findNextFocusable(card, direction)).toBe(expected);
      }
    }
  }
  return handled;
}

describe('recherche sans mesure', () => {
  it('catégories du rail : même carte que la recherche habituelle, partout', () => {
    const { cards } = home([
      { from: 0, to: 10, scrollLeft: 0 },
      { from: 0, to: 10, scrollLeft: 356 },
      { from: 0, to: 10, scrollLeft: 801 },
      { from: 0, to: 9, scrollLeft: 89 },
      { from: 0, to: 10, scrollLeft: 1300, gap: 20 },
    ]);
    // La plupart des appuis sont pris sans mesure : le gain attendu
    expect(compareAll(cards)).toBeGreaterThan(150);
  });

  it('emplacement encore gris au milieu : la recherche habituelle le traite', () => {
    const { cards } = home([
      { from: 0, to: 10, scrollLeft: 0 },
      { from: 0, to: 10, scrollLeft: 178 },
      { from: 0, to: 0, scrollLeft: 0, gray: true },
      { from: 0, to: 10, scrollLeft: 0 },
    ]);
    compareAll(cards);
    // Au-dessus et en dessous de l'emplacement gris : rien sans mesure
    expect(modelTarget(cards[1][3], 'down')).toBeNull();
    expect(modelTarget(cards[3][3], 'up')).toBeNull();
  });

  it('bout de rangée, première rangée vers la bannière, dernière rangée : la recherche habituelle décide', () => {
    const { cards, hero } = home([{ from: 0, to: 5, scrollLeft: 0 }, { from: 0, to: 5, scrollLeft: 0 }]);
    expect(modelTarget(cards[0][0], 'left')).toBeNull();
    expect(modelTarget(cards[0][5], 'right')).toBeNull();
    expect(modelTarget(cards[0][2], 'up')).toBeNull();
    expect(hero.contains(findNextFocusable(cards[0][2], 'up'))).toBe(true);
    // Sous la dernière rangée vient le calque des rangées, pas un emplacement
    expect(modelTarget(cards[1][2], 'down')).toBeNull();
  });

  it('carte voisine absente : la recherche habituelle décide', () => {
    const { cards } = home([{ from: 2, to: 6, scrollLeft: 300 }]);
    expect(modelTarget(cards[0][0], 'left')).toBeNull();
    expect(modelTarget(cards[0][1], 'left')).toBe(cards[0][0]);
  });

  it('carte sélectionnée agrandie (TV) : son centre ne bouge pas, même choix', () => {
    const { cards } = home([{ from: 0, to: 8, scrollLeft: 0 }, { from: 0, to: 8, scrollLeft: 120 }]);
    for (const card of cards[0]) {
      const plain = card.getBoundingClientRect.bind(card);
      // Agrandie de 6 % depuis le haut au centre
      card.getBoundingClientRect = () => {
        const r = plain();
        return rect(r.left - r.width * 0.03, r.top, r.width * 1.06, r.height * 1.06);
      };
    }
    expect(compareAll(cards)).toBeGreaterThan(30);
  });

  it('calque au premier plan monté (fiche, fenêtre) : la recherche habituelle décide', () => {
    const { cards } = home([{ from: 0, to: 5, scrollLeft: 0 }, { from: 0, to: 5, scrollLeft: 0 }]);
    const layer = document.createElement('div');
    layer.setAttribute('data-nav-layer', 'modal');
    const inside = document.createElement('button');
    inside.getBoundingClientRect = () => rect(300, 300, 100, 40);
    layer.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    layer.append(inside);
    document.body.append(layer);
    expect(modelTarget(cards[0][2], 'down')).toBeNull();
    expect(findNextFocusable(cards[0][2], 'down')).not.toBe(cards[1][2]);
  });

  it('hors TV : la recherche habituelle décide', () => {
    const { cards } = home([{ from: 0, to: 5, scrollLeft: 0 }, { from: 0, to: 5, scrollLeft: 0 }]);
    setTvMode(false);
    expect(modelTarget(cards[0][2], 'down')).toBeNull();
  });

  it('rangées des suggestions (hors du rail) : la recherche habituelle décide', () => {
    const { cards } = home([
      { from: 0, to: 8, scrollLeft: 0, suggestion: true },
      { from: 0, to: 8, scrollLeft: 89, suggestion: true },
    ]);
    for (const row of cards) for (const card of row) for (const direction of DIRECTIONS) expect(modelTarget(card, direction)).toBeNull();
  });
});
