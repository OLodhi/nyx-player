/**
 * Défilement qui suit la sélection et cadence d'une flèche maintenue, vus de la télécommande.
 *
 * La vue suit la sélection par une animation, plus courte sur TV (ressort léger). La télécommande Android TV répète une
 * touche
 * maintenue par un `keydown` toutes les 50 ms après environ 0,4 s, sans jamais marquer la répétition
 * (`repeat` reste faux) : la cadence doit tenir sans `event.repeat`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setTvMode } from '../platform';
import {
  HELD_LATERAL_STEP_MS,
  HELD_VERTICAL_STEP_MS,
  installSpatialNavigation,
  TAP_QUEUE_MAX,
} from '../spatialNavigation';

/** Cadence de la télécommande : premier délai avant la répétition, puis un `keydown` toutes les… */
const FIRST_REPEAT_MS = 402; // relevé sur la télécommande
const REMOTE_REPEAT_MS = 50;

function rect(x: number, y: number, w = 100, h = 60): DOMRect {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect;
}

const press = (type: 'keydown' | 'keyup', key: string) => {
  const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true, repeat: false });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

/** Page qui défile (jsdom ne calcule ni défilement ni géométrie) : la position à l'écran suit `scrollTop`. */
function scrollPage(scrollHeight = 3000, clientHeight = 720): HTMLDivElement {
  const page = document.createElement('div');
  document.body.appendChild(page);
  page.getBoundingClientRect = () => rect(0, 0, 1280, clientHeight);
  page.style.overflowY = 'auto';
  let position = 0;
  Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
  Object.defineProperty(page, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(page, 'clientHeight', { value: clientHeight });
  return page;
}

function pageBtn(page: HTMLElement, y: number): HTMLButtonElement {
  const el = document.createElement('button');
  page.appendChild(el);
  el.getBoundingClientRect = () => rect(0, y - page.scrollTop, 100, 60);
  return el;
}

/**
 * `count` boutons en colonne (Bas) ou en ligne (Droite), sans défilement, dans `parent` : par défaut une zone de
 * rangées d'affiches (`data-nav-cadence`), là où les appuis Haut / Bas rapprochés sont cadencés sur TV.
 */
function line(count: number, axis: 'vertical' | 'lateral', parent: HTMLElement = cadenceZone()): HTMLButtonElement[] {
  return Array.from({ length: count }, (_, i) => {
    const el = document.createElement('button');
    parent.appendChild(el);
    el.getBoundingClientRect = () => (axis === 'vertical' ? rect(0, i * 80) : rect(i * 120, 0));
    return el;
  });
}

/** Conteneur ajouté à la page ; `attrs` : ses attributs (zone cadencée, fenêtre…). */
function container(attrs: Record<string, string>): HTMLDivElement {
  const el = document.createElement('div');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

const cadenceZone = () => container({ 'data-nav-cadence': '' });

const indexOfFocus = (items: HTMLElement[]) => items.indexOf(document.activeElement as HTMLElement);

let uninstall: () => void = () => {};
let frames: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  frames = vi.spyOn(window, 'requestAnimationFrame');
  uninstall = installSpatialNavigation();
});

afterEach(() => {
  uninstall();
  frames.mockRestore();
  vi.useRealTimers();
  setTvMode(false);
  document.body.innerHTML = '';
});

describe('défilement qui suit la sélection', () => {
  it('TV : la page suit par une animation courte (ressort léger), jusqu’à la cible exacte', () => {
    setTvMode(true);
    const page = scrollPage();
    const a = pageBtn(page, 0);
    const b = pageBtn(page, 1000);
    a.focus();
    press('keydown', 'ArrowDown');
    expect(document.activeElement).toBe(b);
    expect(page.scrollTop).toBe(0);
    expect(frames).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(page.scrollTop).toBeGreaterThan(0);
    expect(page.scrollTop).toBeLessThan(670);
    vi.advanceTimersByTime(1200);
    expect(page.scrollTop).toBe(1000 + 30 - 360);
  });

  it('TV : un carrousel glisse vers l’affiche suivante (latéral)', () => {
    setTvMode(true);
    const track = document.createElement('div');
    document.body.appendChild(track);
    track.style.overflowX = 'auto';
    track.getBoundingClientRect = () => rect(0, 0, 1000, 200);
    let position = 0;
    Object.defineProperty(track, 'scrollLeft', { get: () => position, set: (v: number) => (position = v), configurable: true });
    Object.defineProperty(track, 'scrollWidth', { value: 4000 });
    Object.defineProperty(track, 'clientWidth', { value: 1000 });
    Object.defineProperty(track, 'offsetWidth', { value: 1000 });
    const cards = [0, 1200].map((x) => {
      const card = document.createElement('button');
      track.appendChild(card);
      card.getBoundingClientRect = () => rect(x - track.scrollLeft, 50, 200, 100);
      return card;
    });
    cards[0].focus();
    press('keydown', 'ArrowRight');
    expect(document.activeElement).toBe(cards[1]);
    expect(track.scrollLeft).toBe(0);
    vi.advanceTimersByTime(1200);
    // Au plus près : la carte (1200 à 1400) arrive au bord droit de la zone visible (1000 px)
    expect(track.scrollLeft).toBe(400);
  });

  it('bureau et téléphone : la même flèche anime toujours le défilement (inchangé)', () => {
    setTvMode(false);
    const page = scrollPage();
    const a = pageBtn(page, 0);
    pageBtn(page, 1000);
    a.focus();
    press('keydown', 'ArrowDown');
    expect(page.scrollTop).toBe(0);
    expect(frames).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(page.scrollTop).toBeGreaterThan(0);
    expect(page.scrollTop).toBeLessThan(670);
    vi.advanceTimersByTime(1200);
    expect(page.scrollTop).toBe(670);
  });

  it('TV : une zone de texte qui défile (synopsis) reste animée', () => {
    setTvMode(true);
    const zone = document.createElement('div');
    zone.tabIndex = 0;
    zone.setAttribute('data-nav-scroll', '');
    document.body.appendChild(zone);
    zone.getBoundingClientRect = () => rect(0, 0);
    Object.defineProperty(zone, 'scrollHeight', { value: 400 });
    Object.defineProperty(zone, 'clientHeight', { value: 100 });
    let position = 0;
    Object.defineProperty(zone, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    zone.focus();
    press('keydown', 'Enter');
    press('keyup', 'Enter');
    press('keydown', 'ArrowDown');
    expect(zone.scrollTop).toBe(0);
    vi.advanceTimersByTime(1200);
    expect(zone.scrollTop).toBeGreaterThan(0);
  });
});

describe('cadence d’une flèche maintenue (répétitions non marquées)', () => {
  /**
   * Tient `key` pendant `holdMs` à la cadence de la télécommande (premier `keydown`, première répétition à
   * FIRST_REPEAT_MS, puis toutes les REMOTE_REPEAT_MS, décalées de `jitter(i)` ms) ; rend l'instant de chaque pas.
   */
  function hold(items: HTMLElement[], key: string, holdMs: number, jitter: (i: number) => number = () => 0): number[] {
    const start = Date.now();
    const moves: number[] = [];
    const send = () => {
      const before = indexOfFocus(items);
      press('keydown', key);
      if (indexOfFocus(items) !== before) moves.push(Date.now() - start);
    };
    send();
    let at = 0;
    for (let i = 0, t = FIRST_REPEAT_MS; t <= holdMs; i += 1, t += REMOTE_REPEAT_MS) {
      const next = t + jitter(i);
      vi.advanceTimersByTime(next - at);
      at = next;
      send();
    }
    press('keyup', key);
    return moves;
  }

  it('Bas maintenu 3 s : premier pas immédiat, puis la première répétition, puis un pas toutes les 400 ms', () => {
    setTvMode(true);
    const items = line(100, 'vertical');
    items[0].focus();
    const moves = hold(items, 'ArrowDown', 3000);
    expect(HELD_VERTICAL_STEP_MS).toBe(400);
    // Aucun délai ajouté : le premier appui à 0, la première répétition de la télécommande acceptée telle quelle
    expect(moves).toEqual([0, 402, 802, 1202, 1602, 2002, 2402, 2802]);
  });

  it('Droite maintenue 3 s : inchangé, un pas toutes les 200 ms', () => {
    setTvMode(true);
    const items = line(100, 'lateral');
    items[0].focus();
    const moves = hold(items, 'ArrowRight', 3000);
    expect(HELD_LATERAL_STEP_MS).toBe(200);
    expect(moves).toEqual([0, ...Array.from({ length: 13 }, (_, k) => 402 + 200 * k)]);
  });

  it('répétitions irrégulières (± 10 ms) : la répétition qui tombe à l’intervalle est prise, jamais celle d’avant', () => {
    setTvMode(true);
    const items = line(100, 'vertical');
    items[0].focus();
    const offsets = [-10, 7, -4, 10, -8, 3, 9]; // 7 valeurs : le décalage change d’un pas à l’autre
    const moves = hold(items, 'ArrowDown', 3000, (i) => offsets[i % offsets.length]);
    const gaps = moves.slice(2).map((t, i) => t - moves[i + 1]);
    // Sans tolérance, une répétition en avance de quelques ms était écartée : le pas tombait 50 ms plus tard
    for (const gap of gaps) expect(Math.abs(gap - HELD_VERTICAL_STEP_MS)).toBeLessThanOrEqual(20);
    expect(moves).toHaveLength(8);
  });

  it('les répétitions écartées sont ignorées, jamais rattrapées après le relâchement', () => {
    setTvMode(true);
    const items = line(100, 'vertical');
    items[0].focus();
    const steps = hold(items, 'ArrowDown', 1500).length;
    vi.advanceTimersByTime(2000);
    expect(indexOfFocus(items)).toBe(steps);
  });

  it('une répétition écartée est consommée : la page ne défile pas d’elle-même', () => {
    setTvMode(true);
    const items = line(10, 'vertical');
    items[0].focus();
    press('keydown', 'ArrowDown');
    vi.advanceTimersByTime(FIRST_REPEAT_MS);
    expect(press('keydown', 'ArrowDown').defaultPrevented).toBe(true); // pas fait
    vi.advanceTimersByTime(REMOTE_REPEAT_MS);
    const skipped = press('keydown', 'ArrowDown');
    expect(skipped.defaultPrevented).toBe(true);
    expect(indexOfFocus(items)).toBe(2);
  });

  it('Bas à la main, appuis rapprochés (160, 181, 198 ms) : jamais plus vite que la touche tenue, aucun appui perdu', () => {
    setTvMode(true);
    const items = line(10, 'vertical');
    items[0].focus();
    const moves: number[] = [];
    const start = Date.now();
    const watch = () => { while (indexOfFocus(items) > moves.length) moves.push(Date.now() - start); };
    for (const gap of [0, 160, 181, 198]) {
      for (let t = 0; t < gap; t += 1) { vi.advanceTimersByTime(1); watch(); }
      press('keydown', 'ArrowDown');
      watch();
      for (let t = 0; t < 40; t += 1) { vi.advanceTimersByTime(1); watch(); }
      press('keyup', 'ArrowDown');
    }
    for (let t = 0; t < 2000; t += 1) { vi.advanceTimersByTime(1); watch(); }
    expect(indexOfFocus(items)).toBe(4);
    // Le premier tout de suite, puis un pas par intervalle de touche tenue (tolérance de 25 ms comprise)
    expect(moves[0]).toBe(0);
    for (let k = 1; k < moves.length; k++) expect(moves[k] - moves[k - 1]).toBeGreaterThanOrEqual(HELD_VERTICAL_STEP_MS - 25);
  });

  it('au-delà de TAP_QUEUE_MAX appuis en attente, les suivants sont ignorés ; une autre touche efface l’attente', () => {
    setTvMode(true);
    const items = line(20, 'vertical');
    items[0].focus();
    for (let k = 0; k < 6; k++) { press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown'); vi.advanceTimersByTime(20); }
    vi.advanceTimersByTime(5000);
    expect(indexOfFocus(items)).toBe(1 + TAP_QUEUE_MAX);

    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown'); // en attente
    press('keydown', 'ArrowUp'); press('keyup', 'ArrowUp'); // l'autre sens : l'attente est effacée, cet appui attend
    vi.advanceTimersByTime(5000);
    expect(indexOfFocus(items)).toBe(1 + TAP_QUEUE_MAX); // +1 (Bas) puis −1 (Haut)
  });

  it('OK pendant l’attente : les appuis gardés sont oubliés, même si OK est pris par un autre écouteur', () => {
    setTvMode(true);
    const items = line(10, 'vertical');
    items[0].focus();
    const consume = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', consume, true);
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'Enter');
    vi.advanceTimersByTime(3000);
    document.removeEventListener('keydown', consume, true);
    expect(indexOfFocus(items)).toBe(1);
  });

  it('sélection déplacée autrement pendant l’attente (clic, fenêtre) : les appuis gardés sont oubliés', () => {
    setTvMode(true);
    const items = line(10, 'vertical');
    items[0].focus();
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    items[6].focus();
    vi.advanceTimersByTime(3000);
    expect(indexOfFocus(items)).toBe(6);
  });

  it('touche tenue juste après les appuis gardés : jamais deux pas à moins d’un intervalle', () => {
    setTvMode(true);
    const items = line(30, 'vertical');
    items[0].focus();
    const moves: number[] = [];
    const start = Date.now();
    const watch = () => { while (indexOfFocus(items) > moves.length) moves.push(Date.now() - start); };
    press('keydown', 'ArrowDown'); watch(); press('keyup', 'ArrowDown');
    vi.advanceTimersByTime(60);
    press('keydown', 'ArrowDown'); watch(); press('keyup', 'ArrowDown');
    vi.advanceTimersByTime(60);
    press('keydown', 'ArrowDown'); watch(); // tenue : répétitions toutes les 50 ms après 402 ms
    for (let t = 0; t < 2000; t += 1) {
      vi.advanceTimersByTime(1);
      if (t >= FIRST_REPEAT_MS && (t - FIRST_REPEAT_MS) % REMOTE_REPEAT_MS === 0) press('keydown', 'ArrowDown');
      watch();
    }
    press('keyup', 'ArrowDown');
    for (let k = 1; k < moves.length; k++) expect(moves[k] - moves[k - 1]).toBeGreaterThanOrEqual(HELD_VERTICAL_STEP_MS - 25);
    expect(moves.length).toBeGreaterThanOrEqual(5);
  });

  it('nouvel appui juste après une touche tenue : il attend l’intervalle, puis avance', () => {
    setTvMode(true);
    const items = line(30, 'vertical');
    items[0].focus();
    hold(items, 'ArrowDown', 1000);
    const before = indexOfFocus(items);
    vi.advanceTimersByTime(30);
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    expect(indexOfFocus(items)).toBe(before);
    vi.advanceTimersByTime(HELD_VERTICAL_STEP_MS);
    expect(indexOfFocus(items)).toBe(before + 1);
  });

  it('Gauche / Droite à la main : jamais freinés', () => {
    setTvMode(true);
    const items = line(10, 'lateral');
    items[0].focus();
    press('keydown', 'ArrowRight'); press('keyup', 'ArrowRight');
    vi.advanceTimersByTime(80);
    press('keydown', 'ArrowRight'); press('keyup', 'ArrowRight');
    expect(indexOfFocus(items)).toBe(2);
  });

  it('hors TV : appuis rapprochés jamais freinés (clavier sous Windows)', () => {
    const items = line(10, 'vertical');
    items[0].focus();
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    expect(indexOfFocus(items)).toBe(2);
  });

  /** Deux appuis Bas à 150 ms d'écart (plus vite que la touche tenue), puis 2 s d'attente : rend l'index atteint. */
  function doubleTap(items: HTMLElement[]): number {
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    vi.advanceTimersByTime(150);
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown');
    const atOnce = indexOfFocus(items);
    vi.advanceTimersByTime(2000);
    expect(indexOfFocus(items)).toBe(atOnce); // rien ne bouge plus tard : aucun appui mis en attente
    return atOnce;
  }

  it('TV, hors des rangées d’affiches (réglages, formulaire) : appuis rapprochés jamais freinés', () => {
    setTvMode(true);
    const items = line(10, 'vertical', document.body);
    items[0].focus();
    expect(doubleTap(items)).toBe(2);
  });

  it('TV, formulaire (e-mail, mot de passe, bouton) : deux appuis rapprochés mènent au bouton, aucun perdu', () => {
    setTvMode(true);
    const form = container({});
    const items = [0, 1, 2].map((i) => {
      const el = document.createElement(i < 2 ? 'input' : 'button');
      if (el instanceof HTMLInputElement) el.type = i === 0 ? 'email' : 'password';
      form.appendChild(el);
      el.getBoundingClientRect = () => rect(0, i * 80);
      return el;
    });
    items[0].focus();
    expect(doubleTap(items)).toBe(2);
  });

  it('TV, fenêtre ouverte sur une page de rangées (commandes du lecteur, choix) : appuis rapprochés jamais freinés, aucun perdu', () => {
    setTvMode(true);
    const modal = container({ 'data-nav-layer': 'modal' });
    cadenceZone().appendChild(modal); // même posée dans l’accueil, la fenêtre n’est pas une rangée d’affiches
    const items = line(10, 'vertical', modal);
    items[0].focus();
    expect(doubleTap(items)).toBe(2);
  });

  it('TV, champ de texte d’une page de rangées (Recherche) : il se quitte librement, l’appui suivant attend son tour sans se perdre', () => {
    setTvMode(true);
    const zone = cadenceZone();
    const field = document.createElement('input');
    field.type = 'text';
    zone.appendChild(field);
    field.getBoundingClientRect = () => rect(0, 0);
    const items = [field, ...line(5, 'vertical', zone).map((el, i) => {
      el.getBoundingClientRect = () => rect(0, (i + 1) * 80);
      return el;
    })];
    field.focus();
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown'); // quitte le champ : libre
    vi.advanceTimersByTime(150);
    press('keydown', 'ArrowDown'); press('keyup', 'ArrowDown'); // dans les rangées : attend son tour
    expect(indexOfFocus(items)).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(indexOfFocus(items)).toBe(2);
  });

  it('OK juste après une flèche maintenue : appui court = un clic, appui long = une seule action', () => {
    setTvMode(true);
    const items = line(10, 'vertical');
    const clicks = vi.fn();
    const longPresses = vi.fn();
    for (const item of items) {
      item.setAttribute('data-nav-longpress', '');
      item.addEventListener('click', clicks);
      item.addEventListener('nyx:longpress', longPresses);
    }
    items[0].focus();
    hold(items, 'ArrowDown', 1000);
    press('keydown', 'Enter');
    press('keyup', 'Enter');
    expect(clicks).toHaveBeenCalledTimes(1);
    // OK maintenu à la cadence de la télécommande : l'appui long agit une fois, sans clic
    press('keydown', 'Enter');
    for (let t = FIRST_REPEAT_MS; t <= 1500; t += REMOTE_REPEAT_MS) {
      vi.advanceTimersByTime(t === FIRST_REPEAT_MS ? FIRST_REPEAT_MS : REMOTE_REPEAT_MS);
      press('keydown', 'Enter');
    }
    press('keyup', 'Enter');
    expect(longPresses).toHaveBeenCalledTimes(1);
    expect(clicks).toHaveBeenCalledTimes(1);
  });
});

describe('rangée suivante montée après l’image (accueil TV)', () => {
  /**
   * Comme l'accueil sur TV : la rangée sous le focus n'est montée qu'après l'image du nouveau focus (prochaine
   * image, puis `mountMs` de travail). Rangées tous les 300 px, la première à 400 px du haut de la page.
   */
  function lazyRows(mountMs: number) {
    const page = scrollPage(20000);
    page.setAttribute('data-nav-cadence', '');
    page.scrollBy = ((options: ScrollToOptions) => {
      page.scrollTop += options.top ?? 0;
    }) as typeof page.scrollBy;
    const rows: HTMLButtonElement[] = [];
    const add = () => rows.push(pageBtn(page, 400 + rows.length * 300));
    add();
    add();
    page.addEventListener('focusin', (event) => {
      const index = rows.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || index + 1 < rows.length - 1) return;
      requestAnimationFrame(() => setTimeout(add, mountMs));
    });
    return rows;
  }

  it('Bas appuyé avant la fin du montage : la sélection attend sur place, puis atteint la rangée (aucune perte)', () => {
    setTvMode(true);
    const rows = lazyRows(150);
    rows[0].focus();
    press('keydown', 'ArrowDown');
    press('keyup', 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    // Second appui 50 ms plus tard : la rangée d'après n'est pas encore montée
    vi.advanceTimersByTime(50);
    expect(rows).toHaveLength(2);
    press('keydown', 'ArrowDown');
    press('keyup', 'ArrowDown');
    expect(document.activeElement).toBe(rows[1]);
    // Montée, puis rattrapée par la nouvelle tentative de la navigation, après la fin du mouvement en cours
    vi.advanceTimersByTime(800);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(document.activeElement).toBe(rows[2]);
  });

  it('Bas maintenu 3 s : un pas toutes les 400 ms, chaque rangée montée à temps, la sélection jamais perdue', () => {
    setTvMode(true);
    const rows = lazyRows(150);
    rows[0].focus();
    const lost: number[] = [];
    press('keydown', 'ArrowDown');
    for (let t = FIRST_REPEAT_MS; t <= 3000; t += REMOTE_REPEAT_MS) {
      vi.advanceTimersByTime(t === FIRST_REPEAT_MS ? FIRST_REPEAT_MS : REMOTE_REPEAT_MS);
      if (!rows.includes(document.activeElement as HTMLButtonElement)) lost.push(t);
      press('keydown', 'ArrowDown');
    }
    press('keyup', 'ArrowDown');
    expect(lost).toEqual([]);
    expect(rows.indexOf(document.activeElement as HTMLButtonElement)).toBe(8);
  });
});
