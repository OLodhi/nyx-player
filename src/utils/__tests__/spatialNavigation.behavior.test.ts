/**
 * Navigation à la télécommande : comportement complet, vu de l'extérieur (API publique et DOM).
 *
 * Ces tests ont été écrits avant le découpage du module pour figer le comportement
 * existant : calques, visibilité, étages nommés, mémoire du dernier focus, défilement de la vue,
 * chargement des rangées au défilement, OK / appui long, champs de texte, pointeur.
 * Ils ne passent que par l'API publique : un réagencement interne ne doit pas les toucher.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dispatchBack, pushBackHandler } from '../../hooks/useBackHandler';
import {
  findNextFocusable,
  focusSidebarEntry,
  installSpatialNavigation,
  LONG_PRESS_MS,
  QUIET_IME_PROPS,
  zoneOf,
} from '../spatialNavigation';

/** Délai de nouvelle tentative du chargement au défilement (120 ms dans le module), avec de la marge. */
const REVEAL_WAIT_MS = 150;

function rect(x: number, y: number, w = 100, h = 60): DOMRect {
  return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) } as DOMRect;
}

/** Ajoute `el` à `parent` et lui donne une position écran (jsdom ne calcule aucune géométrie). */
function put<T extends HTMLElement>(parent: HTMLElement, el: T, x: number, y: number, w = 100, h = 60): T {
  parent.appendChild(el);
  el.getBoundingClientRect = () => rect(x, y, w, h);
  return el;
}

function btn(parent: HTMLElement, x: number, y: number, w = 100, h = 60): HTMLButtonElement {
  return put(parent, document.createElement('button'), x, y, w, h);
}

function div(parent: HTMLElement, attrs: Record<string, string> = {}): HTMLDivElement {
  const el = document.createElement('div');
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  parent.appendChild(el);
  return el;
}

const key = (target: Element, type: string, k: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const arrow = (k: string, init: KeyboardEventInit = {}) => key(document.activeElement!, 'keydown', k, init);

/** Un appui complet sur OK : enfoncé puis relâché (sans relâchement, un second OK serait une répétition). */
const ok = () => {
  const down = arrow('Enter');
  key(document.activeElement!, 'keyup', 'Enter');
  return down;
};

const nativeScrollIntoView = Element.prototype.scrollIntoView;
let scrollIntoView: ReturnType<typeof vi.fn>;
let uninstall: () => void = () => {};

beforeEach(() => {
  document.body.innerHTML = '';
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  uninstall = installSpatialNavigation();
});

afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  document.documentElement.classList.remove('nyx-pointer');
  document.body.innerHTML = '';
});

describe('calques et visibilité', () => {
  it('le calque retenu est le dernier visible : un calque vide (taille nulle) ne masque rien', () => {
    const page = div(document.body, { 'data-nav-layer': 'page' });
    page.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    const a1 = btn(page, 0, 0);
    const a2 = btn(page, 300, 0);
    const empty = div(document.body, { 'data-nav-layer': 'modal' });
    empty.getBoundingClientRect = () => rect(0, 0, 0, 0);
    btn(document.body, 150, 0); // hors calque, plus proche : ne doit pas compter
    expect(findNextFocusable(a1, 'right')).toBe(a2);
  });

  it('deux calques visibles : seul le dernier dans le document est atteignable', () => {
    const page = div(document.body, { 'data-nav-layer': 'page' });
    page.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    const under = btn(page, 0, 300);
    const modal = div(document.body, { 'data-nav-layer': 'modal' });
    modal.getBoundingClientRect = () => rect(400, 200, 400, 300);
    const b1 = btn(modal, 400, 300);
    const b2 = btn(modal, 600, 300);
    expect(findNextFocusable(b1, 'right')).toBe(b2);
    expect(findNextFocusable(b1, 'left')).toBeNull();
    expect(under.isConnected).toBe(true);
  });

  it('rangées hors de l\'écran : proches atteignables, très lointaines ignorées', () => {
    const current = btn(document.body, 0, 0);
    const far = btn(document.body, 0, window.innerHeight * 4 + 10);
    expect(findNextFocusable(current, 'down')).toBeNull();
    far.getBoundingClientRect = () => rect(0, window.innerHeight * 2);
    expect(findNextFocusable(current, 'down')).toBe(far);
  });

  it('élément transparent ou non affiché : ignoré, sauf transparent dans un piège', () => {
    const current = btn(document.body, 0, 0);
    const faded = btn(document.body, 200, 0);
    faded.style.opacity = '0';
    const none = btn(document.body, 400, 0);
    none.style.display = 'none';
    expect(findNextFocusable(current, 'right')).toBeNull();

    const card = put(document.body, div(document.body, { 'data-nav-trap': '', tabindex: '0' }), 0, 200, 300, 100);
    const first = btn(card, 0, 200);
    const fading = btn(card, 150, 200);
    fading.style.opacity = '0'; // actions qui apparaissent en fondu
    expect(findNextFocusable(first, 'right')).toBe(fading);
  });

  it('sans élément courant : le premier élément de la page, pas celui de la barre latérale', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    btn(sidebar, 0, 0);
    const content = btn(document.body, 200, 0);
    expect(findNextFocusable(null, 'down')).toBe(content);
  });

  it('un élément ne se déplace jamais vers son parent ni vers son enfant', () => {
    const card = put(document.body, div(document.body, { tabindex: '0' }), 0, 0, 400, 200);
    const inner = btn(card, 300, 50);
    expect(findNextFocusable(inner, 'left')).toBeNull();
    expect(findNextFocusable(card, 'right')).toBeNull();
  });

  it('zoneOf : barre latérale, barre de catégories, sinon contenu', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    const aside = div(document.body, { 'data-nav-zone': 'aside' });
    const other = div(document.body, { 'data-nav-zone': 'autre' });
    expect(zoneOf(btn(sidebar, 0, 0))).toBe('sidebar');
    expect(zoneOf(btn(aside, 0, 0))).toBe('aside');
    expect(zoneOf(btn(other, 0, 0))).toBe('content');
    expect(zoneOf(btn(document.body, 0, 0))).toBe('content');
  });
});

describe('étages et mémoire du dernier focus', () => {
  it('étage nommé réparti dans le DOM : Gauche/Droite y restent, Haut/Bas en sortent', () => {
    const left = div(document.body);
    const right = div(document.body);
    const a = btn(div(left, { 'data-nav-row': 'hero' }), 0, 100);
    const b = btn(div(right, { 'data-nav-row': 'hero' }), 300, 110);
    const below = btn(document.body, 600, 160); // un peu plus bas, à droite
    expect(findNextFocusable(a, 'right')).toBe(b);
    expect(findNextFocusable(b, 'right')).toBeNull();
    expect(findNextFocusable(a, 'down')).toBe(below);
  });

  it('revenir dans un étage redonne le focus au dernier élément quitté', () => {
    const row = div(document.body, { 'data-nav-row': '' });
    const a = btn(row, 0, 0);
    btn(row, 200, 0);
    const c = btn(row, 400, 0);
    const below = btn(document.body, 0, 200);
    c.focus();
    expect(findNextFocusable(below, 'up')).toBe(c);
    expect(a.isConnected).toBe(true);
  });

  it('carrousels alignés (accueil) : Haut/Bas arrive sur la carte dans l’axe, dans les deux sens, pas sur la carte quittée', () => {
    const top = div(div(document.body, { 'data-nav-align': '' }), { 'data-nav-row': '' });
    const t1 = btn(top, 0, 0);
    const t2 = btn(top, 200, 0);
    const t3 = btn(top, 400, 0);
    const bottom = div(div(document.body, { 'data-nav-align': '' }), { 'data-nav-row': '' });
    const b1 = btn(bottom, 0, 200);
    const b2 = btn(bottom, 200, 200);
    const b3 = btn(bottom, 400, 200);
    t1.focus();
    expect(findNextFocusable(t1, 'down')).toBe(b1);
    b1.focus();
    b3.focus();
    // On avait quitté la rangée du haut sur t1 : en remontant depuis b3, la carte au-dessus
    expect(findNextFocusable(b3, 'up')).toBe(t3);
    t3.focus();
    t2.focus();
    expect(findNextFocusable(t2, 'down')).toBe(b2);
  });

  it('élément mémorisé retiré du DOM : cible géométrique', () => {
    const row = div(document.body, { 'data-nav-row': 'carrousel' });
    const a = btn(row, 0, 0);
    const c = btn(row, 400, 0);
    const below = btn(document.body, 0, 200);
    c.focus();
    c.remove();
    expect(findNextFocusable(below, 'up')).toBe(a);
  });

  it('barre de catégories : on y revient sur le dernier élément focusé ; barre latérale : toujours la page courante', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    const home = btn(sidebar, 0, 0);
    home.classList.add('active');
    const search = btn(sidebar, 0, 100);
    const aside = div(document.body, { 'data-nav-zone': 'aside' });
    const cat1 = btn(aside, 100, 0);
    cat1.classList.add('active');
    const cat2 = btn(aside, 100, 300);
    const grid = btn(document.body, 400, 0);

    cat2.focus();
    expect(findNextFocusable(grid, 'left')).toBe(cat2);
    search.focus();
    expect(findNextFocusable(cat1, 'left')).toBe(home);
  });

  it('barre de catégories sans souvenir : entrée par l\'élément actif', () => {
    const aside = div(document.body, { 'data-nav-zone': 'aside' });
    btn(aside, 0, 0);
    const active = btn(aside, 0, 300);
    active.classList.add('active');
    const grid = btn(document.body, 300, 0);
    expect(findNextFocusable(grid, 'left')).toBe(active);
  });

  it('Haut/Bas ne changent jamais de zone ; un piège ne sort pas latéralement', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    btn(sidebar, 0, 300);
    const content = btn(document.body, 0, 0, 300);
    expect(findNextFocusable(content, 'down')).toBeNull();

    const card = put(document.body, div(document.body, { 'data-nav-trap': '', tabindex: '0' }), 200, 400, 300, 100);
    const action = btn(card, 200, 400);
    expect(findNextFocusable(action, 'left')).toBeNull();
  });

  it('désinstaller oublie les éléments mémorisés', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    const home = btn(sidebar, 0, 0);
    home.classList.add('active');
    const first = btn(document.body, 200, 0);
    const remembered = btn(document.body, 400, 300);
    remembered.focus();
    expect(findNextFocusable(home, 'right')).toBe(remembered);

    uninstall();
    uninstall = installSpatialNavigation();
    expect(findNextFocusable(home, 'right')).toBe(first);
  });
});

/** Horloge simulée, animations d'image comprises. */
const fakeClock = () =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });

/** Page qui défile (jsdom ne calcule ni défilement ni géométrie) : la position à l'écran suit `scrollTop`. */
function scrollPage(scrollHeight = 3000, clientHeight = 720): HTMLDivElement {
  const page = put(document.body, div(document.body), 0, 0, 1280, clientHeight);
  page.style.overflowY = 'auto';
  let position = 0;
  Object.defineProperty(page, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
  Object.defineProperty(page, 'scrollHeight', { value: scrollHeight });
  Object.defineProperty(page, 'clientHeight', { value: clientHeight });
  return page;
}

/** Bouton placé à `y` dans la page : sa position à l'écran se décale avec le défilement. */
function pageBtn(page: HTMLElement, y: number, parent: HTMLElement = page): HTMLButtonElement {
  const el = document.createElement('button');
  parent.appendChild(el);
  el.getBoundingClientRect = () => rect(0, y - page.scrollTop, 100, 60);
  return el;
}

describe('la vue suit la sélection', () => {
  // Centré : (y + 30) − 360 pour une page de 720 px
  it('déplacement simple : élément centré par une animation conduite, jamais un défilement natif animé', () => {
    fakeClock();
    const page = scrollPage();
    const a = pageBtn(page, 0);
    const b = pageBtn(page, 1000);
    a.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(b);
    expect(scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(page.scrollTop).toBeGreaterThan(0);
    expect(page.scrollTop).toBeLessThan(670);
    vi.advanceTimersByTime(1200);
    expect(page.scrollTop).toBe(670);
  });

  // Android TV répète une flèche maintenue sans marquer les répétitions (repeat reste faux)
  it('flèche maintenue : une seule animation qui change de cible, freinée à un pas par intervalle', () => {
    fakeClock();
    const page = scrollPage(6000);
    const items = [0, 1, 2, 3, 4, 5].map((i) => pageBtn(page, i * 400));
    items[0].focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    // La télécommande répète toutes les 50 ms : un pas au plus toutes les HELD_VERTICAL_STEP_MS (0,4 s)
    const seen: number[] = [];
    for (let t = 0; t < 16; t += 1) {
      vi.advanceTimersByTime(50);
      seen.push(page.scrollTop);
      arrow('ArrowDown');
    }
    expect(document.activeElement).toBe(items[3]);
    // La vue n'a jamais reculé pendant la série
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(page.scrollTop).toBe(3 * 400 + 30 - 360);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('tête de page (data-nav-top) : la page remonte tout en haut', () => {
    fakeClock();
    const page = scrollPage();
    page.scrollTop = 500;
    const hero = pageBtn(page, 0, div(page, { 'data-nav-top': '' }));
    const card = pageBtn(page, 800);
    card.focus();
    arrow('ArrowUp');
    expect(document.activeElement).toBe(hero);
    vi.advanceTimersByTime(1200);
    expect(page.scrollTop).toBe(0);
  });
});

describe('rangées chargées au défilement', () => {
  /** Page qui défile (2000 px de contenu pour 700 visibles), sélection à `y` px du haut. */
  function scrollingPage(y = 500) {
    const page = put(document.body, div(document.body), 0, 0, 1280, 700);
    page.style.overflowY = 'auto';
    Object.defineProperty(page, 'scrollHeight', { value: 2000 });
    Object.defineProperty(page, 'clientHeight', { value: 700 });
    const scrollBy = vi.fn();
    page.scrollBy = scrollBy as unknown as typeof page.scrollBy;
    const last = btn(page, 0, y);
    last.focus();
    return { page, scrollBy, last };
  }

  it('sans cible plus bas : la page défile, puis la rangée apparue reçoit le focus', () => {
    vi.useFakeTimers();
    const { page, scrollBy } = scrollingPage();
    const down = arrow('ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    // Pas plus de la moitié de la hauteur visible, ni au point de sortir la sélection de l'écran
    expect(scrollBy).toHaveBeenCalledWith({ top: 350, behavior: 'auto' });

    const next = btn(page, 0, 650);
    vi.advanceTimersByTime(REVEAL_WAIT_MS);
    expect(document.activeElement).toBe(next);
  });

  it('sélection près du haut : le défilement s\'arrête quand elle atteint le bord', () => {
    const { scrollBy } = scrollingPage(200);
    arrow('ArrowDown');
    expect(scrollBy).toHaveBeenCalledWith({ top: 200, behavior: 'auto' });
  });

  it('page déjà tout en bas : rien ne défile', () => {
    const { page, scrollBy } = scrollingPage();
    page.scrollTop = 1300;
    arrow('ArrowDown');
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it('rien ne vient : quatre essais au plus ; touche maintenue : pas de nouveau défilement', () => {
    vi.useFakeTimers();
    const { scrollBy } = scrollingPage();
    arrow('ArrowDown');
    arrow('ArrowDown');
    expect(scrollBy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REVEAL_WAIT_MS * 10);
    expect(scrollBy).toHaveBeenCalledTimes(4);
  });

  it('la sélection a bougé entre-temps : pas de saut', () => {
    vi.useFakeTimers();
    const { page, last } = scrollingPage();
    arrow('ArrowDown');
    const elsewhere = btn(page, 600, 0);
    elsewhere.focus();
    btn(page, 0, 650);
    vi.advanceTimersByTime(REVEAL_WAIT_MS);
    expect(document.activeElement).toBe(elsewhere);
    expect(last.isConnected).toBe(true);
  });

  it('dans une fenêtre : on bute sur son bord, la page derrière ne défile pas', () => {
    const { page, scrollBy, last } = scrollingPage();
    page.setAttribute('data-nav-layer', 'modal');
    const event = arrow('ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it('Gauche/Droite sans cible : rien ne défile, l\'effet natif n\'est pas empêché', () => {
    const { scrollBy } = scrollingPage();
    const event = arrow('ArrowRight');
    expect(event.defaultPrevented).toBe(false);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});

describe('zone qui défile (synopsis)', () => {
  function synopsis() {
    fakeClock();
    const el = put(document.body, div(document.body, { tabindex: '0', 'data-nav-scroll': '' }), 0, 0);
    Object.defineProperty(el, 'scrollHeight', { value: 400 });
    Object.defineProperty(el, 'clientHeight', { value: 100 });
    let position = 100;
    Object.defineProperty(el, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    el.focus();
    return el;
  }

  it('Haut fait remonter le texte ; Gauche/Droite ne quittent pas la zone', () => {
    const el = synopsis();
    btn(document.body, 300, 0);
    arrow('Enter');
    arrow('ArrowUp');
    vi.advanceTimersByTime(1200);
    expect(el.scrollTop).toBe(40);
    arrow('ArrowRight');
    expect(document.activeElement).toBe(el);
    vi.advanceTimersByTime(1200);
    expect(el.scrollTop).toBe(40);
  });

  it('deux pas rapprochés dans la zone : une seule animation, les pas s\'additionnent', () => {
    const el = synopsis();
    btn(document.body, 300, 0);
    arrow('Enter');
    arrow('ArrowDown');
    vi.advanceTimersByTime(100);
    arrow('ArrowDown');
    vi.advanceTimersByTime(1200);
    expect(el.scrollTop).toBe(220);
  });

  it('OK une seconde fois rend les flèches ; perdre le focus aussi', () => {
    const el = synopsis();
    ok();
    ok();
    expect(el.hasAttribute('data-nav-engaged')).toBe(false);
    ok();
    expect(el.hasAttribute('data-nav-engaged')).toBe(true);
    el.blur();
    expect(el.hasAttribute('data-nav-engaged')).toBe(false);
    // Plus rien à fermer : le retour ne s'arrête plus sur la zone (le premier Retour qui quitterait
    // l'app demande confirmation, le second laisse passer)
    expect(dispatchBack()).toBe(true);
    expect(dispatchBack()).toBe(false);
  });
});

describe('OK et appui long', () => {
  function card(mode = '') {
    const el = put(document.body, div(document.body, { tabindex: '0', 'data-nav-longpress': mode }), 0, 0);
    let clicks = 0;
    let longs = 0;
    el.addEventListener('click', () => { clicks += 1; });
    el.addEventListener('nyx:longpress', () => { longs += 1; });
    el.focus();
    return { el, counts: () => [clicks, longs] };
  }

  it('appui long : un seul nyx:longpress, même si la touche se répète', () => {
    vi.useFakeTimers();
    const { counts } = card();
    arrow('Enter');
    arrow('Enter', { repeat: true });
    vi.advanceTimersByTime(LONG_PRESS_MS * 3);
    arrow('Enter', { repeat: true });
    key(document.activeElement!, 'keyup', 'Enter');
    expect(counts()).toEqual([0, 1]);
  });

  // Android TV (WebView) répète OK maintenu sans marquer les répétitions (repeat reste faux)
  it('appui long sur Android, répétitions non marquées : ni ouverture ni second appui', () => {
    vi.useFakeTimers();
    const { el, counts } = card();
    let opened = 0; // ce que fait l'onKeyDown d'une carte (clickableProps) : ouvrir sur Entrée
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') opened += 1; });
    arrow('Enter');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    for (let i = 0; i < 5; i += 1) {
      expect(arrow('Enter').defaultPrevented).toBe(true);
      vi.advanceTimersByTime(50);
    }
    key(document.activeElement!, 'keyup', 'Enter');
    expect(counts()).toEqual([0, 1]);
    expect(opened).toBe(0);
  });

  it('OK maintenu sur un bouton sans appui long (Android) : une seule validation', () => {
    vi.useFakeTimers();
    const button = btn(document.body, 0, 0);
    button.focus();
    expect(arrow('Enter').defaultPrevented).toBe(false);
    vi.advanceTimersByTime(500);
    expect(arrow('Enter').defaultPrevented).toBe(true);
    key(button, 'keyup', 'Enter');
    expect(arrow('Enter').defaultPrevented).toBe(false);
  });

  it('relâchement perdu : le suivi de OK enfoncé périme et n\'avale pas le vrai appui suivant', () => {
    vi.useFakeTimers();
    const { counts } = card();
    arrow('Enter');
    window.dispatchEvent(new Event('blur'));
    // Ni keyup ni blur cette fois : la touche est relâchée hors de la page
    arrow('Enter');
    vi.advanceTimersByTime(LONG_PRESS_MS * 10);
    expect(counts()).toEqual([0, 1]);
    const { counts: autre } = card();
    expect(arrow('Enter').defaultPrevented).toBe(true);
    key(document.activeElement!, 'keyup', 'Enter');
    expect(autre()).toEqual([1, 0]);
  });

  it('la fenêtre perd le focus pendant l\'appui : ni clic ni appui long', () => {
    vi.useFakeTimers();
    const { counts } = card();
    arrow('Enter');
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(LONG_PRESS_MS * 2);
    key(document.activeElement!, 'keyup', 'Enter');
    expect(counts()).toEqual([0, 0]);
  });

  it('élément sans appui long : OK garde son effet natif', () => {
    const button = btn(document.body, 0, 0);
    button.focus();
    expect(arrow('Enter').defaultPrevented).toBe(false);
    expect(key(button, 'keyup', 'Enter').defaultPrevented).toBe(false);
  });

  it('appui court : le clic part au relâchement, pas à l\'appui', () => {
    const { counts } = card();
    const down = arrow('Enter');
    expect(down.defaultPrevented).toBe(true);
    expect(counts()).toEqual([0, 0]);
    const up = key(document.activeElement!, 'keyup', 'Enter');
    expect(up.defaultPrevented).toBe(true);
    expect(counts()).toEqual([1, 0]);
  });

  it('mot de passe sans clavier, appui long passif : le premier OK ouvre le clavier ET lance l\'appui long', () => {
    vi.useFakeTimers();
    const top = btn(document.body, 0, 0);
    const field = put(document.body, document.createElement('input'), 0, 100);
    field.type = 'password';
    field.setAttribute('data-nav-longpress', 'passive');
    let toggled = 0;
    field.addEventListener('nyx:longpress', () => { toggled += 1; });
    top.focus();
    arrow('ArrowDown');
    expect(field.readOnly).toBe(true);

    const ok = arrow('Enter');
    expect(field.readOnly).toBe(false);
    expect(ok.defaultPrevented).toBe(false);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    key(field, 'keyup', 'Enter');
    expect(toggled).toBe(1);
  });

  describe('valider un champ (data-nav-enter-next)', () => {
    function passwordField() {
      const top = btn(document.body, 0, 0);
      const field = put(document.body, document.createElement('input'), 0, 100);
      field.type = 'password';
      field.setAttribute('data-nav-longpress', 'passive');
      field.setAttribute('data-nav-enter-next', 'submit');
      const submit = btn(document.body, 0, 300);
      submit.id = 'submit';
      top.focus();
      arrow('ArrowDown');
      return { field, submit };
    }

    it('premier OK : ouvre le clavier sans changer de sélection', () => {
      const { field } = passwordField();
      ok();
      expect(document.activeElement).toBe(field);
      expect(field.readOnly).toBe(false);
    });

    it('clavier ouvert, OK court : la sélection passe sur le bouton désigné', () => {
      const { field, submit } = passwordField();
      ok();
      expect(document.activeElement).toBe(field);
      ok();
      expect(document.activeElement).toBe(submit);
    });

    it('clavier ouvert, appui long : affiche le mot de passe sans changer de sélection', () => {
      vi.useFakeTimers();
      const { field } = passwordField();
      ok();
      arrow('Enter');
      vi.advanceTimersByTime(LONG_PRESS_MS + 10);
      key(field, 'keyup', 'Enter');
      expect(document.activeElement).toBe(field);
    });
  });
});

describe('ordre des éléments (fiches et Paramètres)', () => {
  // Interrupteurs alignés à droite avec, entre deux, un bouton à gauche : le bouton ne doit pas être sauté
  it('Bas : un bouton hors faisceau, plus proche, passe avant un interrupteur plus bas dans le faisceau', () => {
    const first = btn(document.body, 600, 0, 80, 40);
    const middle = btn(document.body, 0, 100, 300, 40);
    const last = btn(document.body, 600, 200, 80, 40);
    first.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(middle);
    arrow('ArrowDown');
    expect(document.activeElement).toBe(last);
    arrow('ArrowUp');
    expect(document.activeElement).toBe(middle);
  });

  it('Bas : un petit bouton très décalé sur le côté ne vole pas la cible alignée', () => {
    const from = btn(document.body, 0, 0, 80, 40);
    const aligned = btn(document.body, 0, 140, 80, 40);
    btn(document.body, 900, 50, 60, 30);
    from.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(aligned);
  });

  it('Bas : un voisin sur la même ligne (pas entièrement en dessous) n\'est pas pris en diagonale', () => {
    const toggle = btn(document.body, 600, 100, 80, 24);
    btn(document.body, 0, 110, 300, 40);
    const next = btn(document.body, 600, 170, 80, 24);
    toggle.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(next);
  });

  it('Bas : un élément du faisceau reste choisi quand il est le plus proche', () => {
    const field = btn(document.body, 0, 0, 400, 40);
    const check = btn(document.body, 10, 60, 20, 20);
    btn(document.body, 200, 120, 80, 40);
    field.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(check);
  });
});

describe('étages voisins (fiche série : saisons, source, épisodes)', () => {
  function fiche() {
    const back = btn(document.body, 260, 40, 40, 40);
    const seasonRow = div(document.body, { 'data-nav-row': 'saisons' });
    const season = btn(seasonRow, 260, 330, 230, 56);
    const watch = btn(seasonRow, 640, 320, 76, 76);
    const sourceRow = div(document.body, { 'data-nav-row': 'source' });
    const source = btn(sourceRow, 260, 410, 350, 56);
    const episodes = div(document.body, { 'data-nav-row': 'episodes' });
    const first = btn(episodes, 50, 510, 340, 400);
    const far = btn(episodes, 1000, 510, 340, 400);
    return { back, season, watch, source, first, far };
  }

  it('Haut depuis un épisode à droite : l\'étage de la source, pas le bouton Ma liste plus haut', () => {
    const { source, far } = fiche();
    far.focus();
    arrow('ArrowUp');
    expect(document.activeElement).toBe(source);
  });

  it('Haut depuis la source : les saisons ; Bas : la source puis les épisodes', () => {
    const { season, source, first } = fiche();
    source.focus();
    arrow('ArrowUp');
    expect(document.activeElement).toBe(season);
    arrow('ArrowDown');
    expect(document.activeElement).toBe(source);
    arrow('ArrowDown');
    expect(document.activeElement).toBe(first);
  });

  it('Haut depuis les épisodes sans source : les saisons', () => {
    const { source, watch, far } = fiche();
    source.remove();
    far.focus();
    arrow('ArrowUp');
    // Étage des saisons : le bouton le plus proche horizontalement
    expect(document.activeElement).toBe(watch);
  });
});

describe('Paramètres : un bloc = un étage (data-nav-blocks)', () => {
  function page() {
    const menu = div(document.body, { 'data-nav-zone': 'aside' });
    const menuItem = btn(menu, 0, 100, 200, 56);
    const content = div(document.body, { 'data-nav-blocks': '.settings-option, .settings-section > h3, .settings-subsection > *, .setting-item:not(.setting-item--form)' });
    const section = div(content, { class: 'settings-section' });
    const head = document.createElement('h3');
    section.appendChild(head);
    const refresh = btn(head, 900, 40, 120, 40);
    const edit = btn(head, 1030, 40, 120, 40);
    const sub = div(section, { class: 'settings-subsection' });
    const manage = btn(sub, 300, 120, 220, 40);
    const opt1 = div(section, { class: 'settings-option' });
    const toggle1 = btn(opt1, 1050, 200, 80, 30);
    const opt2 = div(section, { class: 'settings-option' });
    const toggle2 = btn(opt2, 1050, 280, 80, 30);
    return { menuItem, refresh, edit, manage, toggle1, toggle2, content };
  }

  it('Bas depuis Rafraîchir : Gérer les catégories (à gauche) n\'est pas sauté', () => {
    const { refresh, manage, toggle1 } = page();
    refresh.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(manage);
    arrow('ArrowDown');
    expect(document.activeElement).toBe(toggle1);
  });

  it('Gauche depuis un interrupteur : droit sur le menu des rubriques, sans monter sur un autre élément', () => {
    const { toggle2, menuItem } = page();
    toggle2.focus();
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(menuItem);
  });

  it('Compte : Gauche depuis le bouton d\'une ligne va au menu, malgré un champ au-dessus à gauche', () => {
    const { menuItem, content } = page();
    const field = put(content, document.createElement('input'), 300, 330, 400, 40);
    const line = div(content, { class: 'setting-item' });
    const action = btn(line, 900, 400, 120, 40);
    expect(field).toBeTruthy();
    action.focus();
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(menuItem);
  });

  it('Gauche depuis Modifier : Rafraîchir, puis le menu', () => {
    const { edit, refresh, menuItem } = page();
    edit.focus();
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(refresh);
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(menuItem);
  });
});

describe('Qui regarde ? : trois rangées, de haut en bas', () => {
  // Langue (en haut à droite), profils (au centre), Se déconnecter (en bas, centré) : le décalage de la
  // langue ne doit pas faire sauter une rangée, ni envoyer Bas sur « Se déconnecter »
  /** Flèche relâchée : deux appuis de suite sans relâchement sont une touche maintenue (freinée) */
  const press = (k: string) => {
    const event = arrow(k);
    key(document.activeElement!, 'keyup', k);
    return event;
  };

  function page() {
    const row = (name: string) => div(document.body, { 'data-nav-row': name });
    const lang = btn(row('profile-language'), 1100, 20, 80, 40);
    const cards = row('profile-cards');
    const first = btn(cards, 400, 250, 200, 200);
    const second = btn(cards, 640, 250, 200, 200);
    const signOut = btn(row('profile-sign-out'), 540, 600, 200, 50);
    return { lang, first, second, signOut };
  }

  it('Bas puis Haut passent par les profils', () => {
    const { lang, first, second, signOut } = page();
    lang.focus();
    press('ArrowDown');
    // Un des profils (le plus proche de la langue) ; Haut le retrouve ensuite
    const profile = document.activeElement;
    expect([first, second]).toContain(profile);
    press('ArrowDown');
    expect(document.activeElement).toBe(signOut);
    press('ArrowUp');
    expect([first, second]).toContain(document.activeElement);
    press('ArrowUp');
    expect(document.activeElement).toBe(lang);
  });

  it('Gauche / Droite restent entre les profils', () => {
    const { first, second } = page();
    first.focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(second);
    press('ArrowRight');
    expect(document.activeElement).toBe(second);
    press('ArrowLeft');
    expect(document.activeElement).toBe(first);
  });
});

describe('champs de texte', () => {
  it('Droite : reste dans le champ tant que le curseur n\'est pas en fin de texte', () => {
    const field = put(document.body, document.createElement('input'), 0, 0, 300);
    const next = btn(document.body, 400, 0);
    field.value = 'dune';
    field.focus();
    field.setSelectionRange(2, 2);
    expect(arrow('ArrowRight').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(field);
    field.setSelectionRange(4, 4);
    arrow('ArrowRight');
    expect(document.activeElement).toBe(next);
  });

  it('texte sélectionné : Gauche/Droite restent dans le champ', () => {
    const field = put(document.body, document.createElement('input'), 200, 0, 300);
    btn(document.body, 0, 0);
    field.value = 'dune';
    field.focus();
    field.setSelectionRange(0, 4);
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(field);
  });

  it('zone multiligne : Bas y reste si elle contient du texte, la quitte si elle est vide', () => {
    const area = put(document.body, document.createElement('textarea'), 0, 0, 300, 100);
    const below = btn(document.body, 0, 200);
    area.value = 'ligne 1';
    area.focus();
    arrow('ArrowDown');
    expect(document.activeElement).toBe(area);
    area.value = '';
    arrow('ArrowDown');
    expect(document.activeElement).toBe(below);
  });

  it('premier OK sur un champ sans clavier : l\'envoi implicite du formulaire est bloqué', () => {
    // Connexion TV (banc, Android) : l'OK qui ouvre le clavier de l'e-mail lançait aussi l'envoi du
    // formulaire (touche Entrée : événement keypress), dont la validation emportait le focus ailleurs
    const form = document.createElement('form');
    document.body.appendChild(form);
    const field = put(form, document.createElement('input'), 0, 0);
    field.type = 'email';
    field.focus();
    expect(field.readOnly).toBe(true);
    arrow('Enter');
    const press = key(field, 'keypress', 'Enter');
    key(field, 'keyup', 'Enter');
    expect(press.defaultPrevented).toBe(true);
    // Un second OK, clavier ouvert, garde son effet natif (validation du champ)
    arrow('Enter');
    expect(key(field, 'keypress', 'Enter').defaultPrevented).toBe(false);
  });

  it('OK dont le relâchement est perdu : un OK rapide sur un autre champ n\'est pas pris pour une répétition', () => {
    // Banc Android : le clavier système absorbe le keyup du premier OK (champ e-mail) ; Retour, Bas,
    // puis OK moins de 2 s après sur le mot de passe était ignoré (répétition supposée)
    vi.useFakeTimers();
    const email = put(document.body, document.createElement('input'), 0, 0);
    const password = put(document.body, document.createElement('input'), 0, 100);
    password.type = 'password';
    email.focus();
    arrow('Enter'); // pas de keyup
    expect(email.readOnly).toBe(false);
    vi.advanceTimersByTime(1500);
    password.focus();
    expect(password.readOnly).toBe(true);
    arrow('Enter');
    expect(password.readOnly).toBe(false);
  });

  it('OK maintenu sur le champ qui vient de s\'ouvrir : répétition ignorée, pas d\'envoi du formulaire', () => {
    const form = document.createElement('form');
    document.body.appendChild(form);
    const email = put(form, document.createElement('input'), 0, 0);
    email.type = 'email';
    email.focus();
    arrow('Enter');
    const repeat = arrow('Enter'); // répétition non marquée, sans keyup
    expect(repeat.defaultPrevented).toBe(true);
    expect(key(email, 'keypress', 'Enter').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(email);
  });

  it('relâchement perdu : le keypress Entrée suivant n\'est plus bloqué', () => {
    const field = put(document.body, document.createElement('input'), 0, 0);
    field.focus();
    arrow('Enter');
    // pas de keyup (reçu par le clavier système) : un appui ultérieur, clavier ouvert
    vi.useFakeTimers();
    vi.advanceTimersByTime(3000);
    arrow('Enter');
    expect(key(field, 'keypress', 'Enter').defaultPrevented).toBe(false);
  });

  it('champ focalisé par la page (autoFocus) : sans clavier jusqu\'à OK', () => {
    const field = put(document.body, document.createElement('input'), 0, 0);
    field.focus();
    expect(field.readOnly).toBe(true);
    arrow('Enter');
    expect(field.readOnly).toBe(false);
  });

  it('QUIET_IME_PROPS : un champ rendu avec ces props s\'ouvre à OK', () => {
    expect(QUIET_IME_PROPS.readOnly).toBe(true);
    const field = put(document.body, document.createElement('input'), 0, 0);
    field.readOnly = QUIET_IME_PROPS.readOnly;
    for (const [name, value] of Object.entries(QUIET_IME_PROPS)) {
      if (name !== 'readOnly') field.setAttribute(name, String(value));
    }
    field.focus();
    arrow('Enter');
    expect(field.readOnly).toBe(false);
  });

  it('clavier système ouvert (fenêtre redimensionnée) : le champ sélectionné est ramené dans la vue', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    const field = put(document.body, document.createElement('input'), 0, 0);
    field.focus();
    window.dispatchEvent(new Event('resize'));
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });

    scrollIntoView.mockClear();
    btn(document.body, 0, 100).focus();
    window.dispatchEvent(new Event('resize'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('clavier, pointeur et retour', () => {
  it('souris : le liseré disparaît au clic et revient à la première touche', () => {
    const button = btn(document.body, 0, 0);
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(document.documentElement.classList.contains('nyx-pointer')).toBe(true);
    button.focus();
    arrow('Shift');
    expect(document.documentElement.classList.contains('nyx-pointer')).toBe(false);
  });

  it('touche déjà traitée par un composant : la navigation ne fait rien', () => {
    const a = btn(document.body, 0, 0);
    btn(document.body, 200, 0);
    a.addEventListener('keydown', (e) => e.preventDefault());
    a.focus();
    arrow('ArrowRight');
    expect(document.activeElement).toBe(a);
  });

  it('Retour arrière hors d\'un champ : c\'est un retour', () => {
    let closed = 0;
    const release = pushBackHandler(() => { closed += 1; });
    const button = btn(document.body, 0, 0);
    button.focus();
    const event = arrow('Backspace');
    release();
    expect(closed).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('touches sans rôle (lettres) : rien n\'est empêché', () => {
    const button = btn(document.body, 0, 0);
    btn(document.body, 200, 0);
    button.focus();
    expect(arrow('a').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('Retour sous une fenêtre : pas de barre latérale atteignable, le retour suit son cours', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    btn(sidebar, 0, 0).classList.add('active');
    const modal = div(document.body, { 'data-nav-layer': 'modal' });
    modal.getBoundingClientRect = () => rect(0, 0, 1280, 720);
    const ok = btn(modal, 400, 300);
    ok.focus();
    expect(focusSidebarEntry()).toBe(false);
    expect(document.activeElement).toBe(ok);
  });

  it('barre latérale sans icône active : focus sur sa première icône', () => {
    const sidebar = div(document.body, { 'data-nav-zone': 'sidebar' });
    const first = btn(sidebar, 0, 0);
    btn(sidebar, 0, 100);
    btn(document.body, 200, 0).focus();
    expect(focusSidebarEntry()).toBe(true);
    expect(document.activeElement).toBe(first);
  });
});

describe('grille qui choisit sa cible (data-nav-grid, guide TV)', () => {
  it('la grille qui annule nyx:nav-move désigne la cible ; sans cible, la sélection reste', () => {
    const grid = div(document.body, { 'data-nav-grid': '' });
    const a = btn(grid, 0, 0);
    const far = btn(grid, 600, 0);
    const near = btn(grid, 120, 0);
    let target: HTMLElement | null = far;
    grid.addEventListener('nyx:nav-move', (event) => {
      event.preventDefault();
      (event as CustomEvent<{ next: HTMLElement | null }>).detail.next = target;
    });
    a.focus();
    expect(arrow('ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(far); // pas le plus proche : celui de la grille
    target = null;
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(far);
    expect(near).toBeTruthy();
  });

  it('sans annulation, la navigation habituelle s\'applique', () => {
    const grid = div(document.body, { 'data-nav-grid': '' });
    const a = btn(grid, 0, 0);
    const near = btn(grid, 120, 0);
    const seen = vi.fn();
    grid.addEventListener('nyx:nav-move', (event) => seen((event as CustomEvent<{ direction: string }>).detail.direction));
    a.focus();
    arrow('ArrowRight');
    expect(seen).toHaveBeenCalledWith('right');
    expect(document.activeElement).toBe(near);
  });
});
