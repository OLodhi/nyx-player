/**
 * Navigation directionnelle : la cible doit être celle qu'on voit à l'écran dans la direction
 * demandée, pas la suivante dans le DOM (grilles de chaînes, carrousels).
 */

import { settleScroll } from '../spatialNavigation/scrollAnimator';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { findNextFocusable, HELD_VERTICAL_STEP_MS, installSpatialNavigation, LONG_PRESS_MS } from '../spatialNavigation';
import { remember } from '../spatialNavigation/focusMemory';

/** Place un bouton à des coordonnées écran données (jsdom ne calcule pas les positions). */
function button(id: string, x: number, y: number, w = 100, h = 60): HTMLElement {
  const el = document.createElement('button');
  el.id = id;
  document.body.appendChild(el);
  el.getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  return el;
}

describe('spatialNavigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('suit la géométrie et non l\'ordre du DOM', () => {
    // DOM : droite ajouté avant gauche, pour vérifier qu'on ne suit pas l'ordre du code
    const right = button('right', 300, 100);
    const left = button('left', 0, 100);
    const current = button('current', 150, 100);
    const below = button('below', 150, 300);

    expect(findNextFocusable(current, 'right')).toBe(right);
    expect(findNextFocusable(current, 'left')).toBe(left);
    expect(findNextFocusable(current, 'down')).toBe(below);
  });

  it('préfère l\'élément aligné à un élément plus proche mais décalé', () => {
    const current = button('current', 0, 0);
    const aligned = button('aligned', 0, 200);
    button('offset', 400, 150); // plus proche en distance brute, mais très décalé
    expect(findNextFocusable(current, 'down')).toBe(aligned);
  });

  it('ne renvoie rien s\'il n\'y a personne dans cette direction', () => {
    const current = button('current', 0, 0);
    button('right', 300, 0);
    expect(findNextFocusable(current, 'left')).toBeNull();
    expect(findNextFocusable(current, 'up')).toBeNull();
  });

  it('ignore les éléments masqués ou désactivés', () => {
    const current = button('current', 0, 0);
    const disabled = button('disabled', 200, 0);
    disabled.setAttribute('disabled', '');
    const hidden = button('hidden', 400, 0);
    hidden.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    expect(findNextFocusable(current, 'right')).toBeNull();
  });

  it('déplace le focus à la flèche et se désinstalle proprement', () => {
    const current = button('current', 0, 0);
    const right = button('right', 200, 0);
    right.scrollIntoView = () => {};
    current.focus();

    const uninstall = installSpatialNavigation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(right);

    uninstall();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(document.activeElement).toBe(right);
  });
});

describe('rangées en colonnes communes (bannière de l\'accueil)', () => {
  function rangee(name: string, y: number, ids: string[], x0 = 0): HTMLElement[] {
    const row = document.createElement('div');
    row.setAttribute('data-nav-cols', name);
    row.getBoundingClientRect = () =>
      ({ left: 0, top: y, right: 600, bottom: y + 60, width: 600, height: 60, x: 0, y, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(row);
    return ids.map((id, i) => {
      const el = button(id, x0 + i * 200, y);
      row.appendChild(el);
      return el;
    });
  }

  beforeEach(() => { document.body.innerHTML = ''; });

  it('Bas et Haut passent à l\'élément de même rang, quel que soit le dernier focusé de l\'autre rangée', () => {
    const [lecture, details, watch] = rangee('banner', 0, ['lecture', 'details', 'watch']);
    // Les pastilles sont décalées (plus larges) : la géométrie seule enverrait ailleurs
    const [sugg, films, series] = rangee('banner', 200, ['sugg', 'films', 'series'], 300);

    expect(findNextFocusable(lecture, 'down')).toBe(sugg);
    expect(findNextFocusable(details, 'down')).toBe(films);
    expect(findNextFocusable(watch, 'down')).toBe(series);
    expect(findNextFocusable(sugg, 'up')).toBe(lecture);
    expect(findNextFocusable(series, 'up')).toBe(watch);
  });

  function bannerAvecPoints(dotX: number, dotY: number) {
    const [lecture, details, watch] = rangee('banner', 0, ['lecture', 'details', 'watch']);
    const [sugg, films, series] = rangee('banner', 200, ['sugg', 'films', 'series'], 0);
    for (const pill of [sugg, films, series]) pill.closest('[data-nav-cols]')?.setAttribute('data-nav-row', 'dashboard-modes');
    const dots = document.createElement('div');
    dots.setAttribute('data-nav-row', 'hero-dots');
    const dot = button('dot', dotX, dotY);
    dot.setAttribute('data-nav-lateral-only', '');
    dots.appendChild(dot);
    document.body.appendChild(dots);
    return { lecture, details, watch, sugg, films, series, dot };
  }

  it('les points forment leur étage : Bas depuis Lecture reste sur Suggestions, même si un point a été quitté en dernier', () => {
    const { lecture, details, watch, sugg, films, series, dot } = bannerAvecPoints(250, 100);
    remember(dot);

    expect(findNextFocusable(lecture, 'down')).toBe(sugg);
    expect(findNextFocusable(details, 'down')).toBe(films);
    expect(findNextFocusable(watch, 'down')).toBe(series);
  });

  it('depuis un point : Haut mène aux boutons de la bannière, Bas à Suggestions / Films / Séries', () => {
    const { lecture, details, watch, sugg, films, series, dot } = bannerAvecPoints(250, 100);

    expect([lecture, details, watch]).toContain(findNextFocusable(dot, 'up'));
    expect([sugg, films, series]).toContain(findNextFocusable(dot, 'down'));
  });

  it('Droite depuis la fin d\'une rangée de la bannière atteint les points', () => {
    const { series, dot } = bannerAvecPoints(700, 200);
    expect(findNextFocusable(series, 'right')).toBe(dot);
  });

  it('Droite arrive toujours sur le premier point, quelle que soit la rangée, et Gauche au bout des points ramène à cette rangée', () => {
    const { watch, series, dot } = bannerAvecPoints(700, 200);
    // Deux autres points : le plus proche de la rangée basse n'est pas le premier
    const dots = dot.parentElement as HTMLElement;
    const second = button('dot2', 900, 200);
    const third = button('dot3', 1100, 100);
    for (const d of [second, third]) {
      d.setAttribute('data-nav-lateral-only', '');
      dots.appendChild(d);
    }
    expect(findNextFocusable(series, 'right')).toBe(dot);
    expect(findNextFocusable(dot, 'left')).toBe(series);
    expect(findNextFocusable(second, 'left')).toBe(dot);
    expect(findNextFocusable(watch, 'right')).toBe(dot);
    expect(findNextFocusable(dot, 'left')).toBe(watch);
  });

  it('Haut depuis le carrousel mène aux pastilles Suggestions / Films / Séries, jamais aux points, même quittés en dernier', () => {
    const [sugg, films, series] = rangee('banner', 200, ['sugg', 'films', 'series'], 0);
    for (const pill of [sugg, films, series]) pill.closest('[data-nav-cols]')?.setAttribute('data-nav-row', 'dashboard-modes');
    // Les points sont plus bas que les pastilles, donc plus proches du carrousel
    const dots = document.createElement('div');
    dots.setAttribute('data-nav-row', 'dashboard-modes');
    const dot = button('dot', 200, 280);
    dot.setAttribute('data-nav-lateral-only', '');
    dots.appendChild(dot);
    document.body.appendChild(dots);
    const card = button('card', 200, 500);
    remember(dot);

    expect(findNextFocusable(card, 'up')).toBe(films);
  });

  it('une rangée plus courte : le dernier élément', () => {
    const [, , watch] = rangee('banner', 0, ['lecture', 'details', 'watch']);
    const [, films] = rangee('banner', 200, ['sugg', 'films'], 300);
    expect(findNextFocusable(watch, 'down')).toBe(films);
  });
});

describe('touche Retour (clavier de TV, tests sur PC)', () => {
  it('Échap déclenche la pile de retour, pas la navigation', async () => {
    const { useBackHandler } = await import('../../hooks/useBackHandler');
    const { renderHook } = await import('@testing-library/react');

    let closed = false;
    const { unmount } = renderHook(() => useBackHandler(true, () => { closed = true; }));

    const uninstall = installSpatialNavigation();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(true);
    uninstall();
    unmount();
  });

  it('Retour arrière dans un champ de saisie reste une correction de texte', async () => {
    const { useBackHandler } = await import('../../hooks/useBackHandler');
    const { renderHook } = await import('@testing-library/react');

    let closed = false;
    const { unmount } = renderHook(() => useBackHandler(true, () => { closed = true; }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const uninstall = installSpatialNavigation();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(closed).toBe(false);
    uninstall();
    unmount();
  });
});

describe('règles de parcours TV (zones, pièges, appui long, défilement)', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installSpatialNavigation();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  /** Place un élément dans un conteneur donné. */
  function place(parent: HTMLElement, id: string, x: number, y: number, tag = 'button'): HTMLElement {
    const el = document.createElement(tag);
    el.id = id;
    parent.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + 100, bottom: y + 60, width: 100, height: 60, x, y, toJSON: () => ({}) }) as DOMRect;
    el.scrollIntoView = () => {};
    return el;
  }

  function zone(name?: string): HTMLElement {
    const el = document.createElement('div');
    if (name) el.setAttribute('data-nav-zone', name);
    document.body.appendChild(el);
    return el;
  }

  const press = (key: string, type: 'keydown' | 'keyup' = 'keydown') =>
    document.activeElement!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));

  it('ignore les boutons retirés du parcours (tabindex -1)', () => {
    const content = zone();
    const current = place(content, 'card', 0, 0);
    place(content, 'inner', 200, 0).setAttribute('tabindex', '-1');
    expect(findNextFocusable(current, 'right')).toBeNull();
  });

  it("ne passe dans la barre latérale que latéralement, sur l'icône active", () => {
    const sidebar = zone('sidebar');
    place(sidebar, 'nav-search', 0, 0);
    const home = place(sidebar, 'nav-home', 0, 100);
    home.classList.add('active');
    const content = zone();
    const hero = place(content, 'hero-play', 200, 300);

    // En haut de la page : Haut ne remonte pas dans la barre
    expect(findNextFocusable(hero, 'up')).toBeNull();
    // Buter à gauche : entrée par la page courante
    expect(findNextFocusable(hero, 'left')).toBe(home);
  });

  it('revient dans la page sur le dernier élément focusé', () => {
    const sidebar = zone('sidebar');
    const home = place(sidebar, 'nav-home', 0, 0);
    home.classList.add('active');
    const content = zone();
    place(content, 'first', 200, 0);
    const remembered = place(content, 'remembered', 400, 300);

    remembered.focus();
    home.focus();
    expect(findNextFocusable(home, 'right')).toBe(remembered);
  });

  it("bord d'un piège : événement nyx:nav-edge, le focus reste", () => {
    const content = zone();
    const card = place(content, 'card', 0, 0, 'div');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-nav-trap', '');
    const action = place(card, 'watchlist', 0, 0);
    place(content, 'other', 0, 300);

    let edge = '';
    card.addEventListener('nyx:nav-edge', (e) => { edge = (e as CustomEvent).detail.direction; });
    action.focus();
    press('ArrowDown');
    expect(edge).toBe('down');
    expect(document.activeElement).toBe(action);
  });

  it('étages : Haut/Bas en sortent, Gauche/Droite y restent, sauf dans les actions d\'une carte', () => {
    const content = zone();
    const row = document.createElement('div');
    row.setAttribute('data-nav-row', 'true'); // attribut sans valeur écrit par JSX
    content.appendChild(row);
    const card = place(row, 'card', 0, 100, 'div');
    card.setAttribute('tabindex', '0');
    const nextCard = place(row, 'next', 300, 100, 'div');
    nextCard.setAttribute('tabindex', '0');
    const lower = place(content, 'lower', 600, 160); // un peu plus bas que l'étage, à droite

    expect(findNextFocusable(card, 'right')).toBe(nextCard);
    expect(findNextFocusable(nextCard, 'right')).toBeNull();
    expect(findNextFocusable(card, 'down')).toBe(lower);

    // Actions ouvertes : les deux boutons sont dans le même carrousel, Bas doit passer de l'un à l'autre
    card.setAttribute('data-nav-trap', '');
    const watchlist = place(card, 'watchlist', 0, 100);
    const info = place(card, 'info', 60, 200);
    expect(findNextFocusable(watchlist, 'down')).toBe(info);
  });

  it('appui court = clic, appui long = nyx:longpress sans clic', () => {
    const content = zone();
    const card = place(content, 'card', 0, 0, 'div');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-nav-longpress', '');
    let clicks = 0;
    let longPresses = 0;
    card.addEventListener('click', () => { clicks += 1; });
    card.addEventListener('nyx:longpress', () => { longPresses += 1; });
    card.focus();

    press('Enter');
    press('Enter', 'keyup');
    expect([clicks, longPresses]).toEqual([1, 0]);

    vi.useFakeTimers();
    press('Enter');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    press('Enter', 'keyup');
    vi.useRealTimers();
    expect([clicks, longPresses]).toEqual([1, 1]);
  });

  it('zone qui défile : OK active les flèches, Retour les rend', () => {
    const content = zone();
    const synopsis = place(content, 'synopsis', 0, 0, 'div');
    synopsis.setAttribute('tabindex', '0');
    synopsis.setAttribute('data-nav-scroll', '');
    Object.defineProperty(synopsis, 'scrollHeight', { value: 400 });
    Object.defineProperty(synopsis, 'clientHeight', { value: 100 });
    let scrolled = 0;
    Object.defineProperty(synopsis, 'scrollTop', { get: () => scrolled, set: (v: number) => (scrolled = v), configurable: true });
    const below = place(content, 'play', 0, 300);
    synopsis.focus();

    press('Enter');
    expect(synopsis.hasAttribute('data-nav-engaged')).toBe(true);
    press('ArrowDown');
    settleScroll(synopsis);
    expect(scrolled).toBe(60);
    expect(document.activeElement).toBe(synopsis);

    press('Escape');
    expect(synopsis.hasAttribute('data-nav-engaged')).toBe(false);
    press('ArrowDown');
    expect(document.activeElement).toBe(below);
  });

  it('zone qui ne déborde pas : hors parcours', () => {
    const content = zone();
    const current = place(content, 'back', 0, 0);
    const synopsis = place(content, 'synopsis', 0, 100, 'div');
    synopsis.setAttribute('tabindex', '0');
    synopsis.setAttribute('data-nav-scroll', '');
    const play = place(content, 'play', 0, 300);
    expect(findNextFocusable(current, 'down')).toBe(play);
  });

  it('Retour sans rien à fermer : focus sur la barre latérale, puis laisse passer au second appui', async () => {
    const { dispatchBack } = await import('../../hooks/useBackHandler');
    const sidebar = zone('sidebar');
    const home = place(sidebar, 'nav-home', 0, 0);
    home.classList.add('active');
    const content = zone();
    place(content, 'card', 200, 0).focus();

    expect(dispatchBack()).toBe(true);
    expect(document.activeElement).toBe(home);
    // Déjà sur la barre : un premier Retour demande confirmation, le second suit son cours (sortie
    // de l'app sur Android)
    expect(dispatchBack()).toBe(true);
    expect(dispatchBack()).toBe(false);
  });

  it('une fiche au premier plan cache la page dessous mais laisse la barre latérale', () => {
    const sidebar = zone('sidebar');
    const home = place(sidebar, 'nav-home', 0, 300);
    home.classList.add('active');
    const underneath = zone();
    place(underneath, 'dashboard-card', 400, 600);
    const layer = zone();
    layer.setAttribute('data-nav-layer', 'page');
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const play = place(layer, 'play', 400, 300);

    expect(findNextFocusable(play, 'down')).toBeNull();
    expect(findNextFocusable(play, 'left')).toBe(home);
  });

  it('sous une fiche, la page dessous n\'est pas mesurée à chaque appui (Chromecast)', () => {
    const sidebar = zone('sidebar');
    const home = place(sidebar, 'nav-home', 0, 300);
    const underneath = zone();
    const cachees = Array.from({ length: 40 }, (_, i) => place(underneath, `dashboard-card-${i}`, 400 + i, 600));
    const layer = zone();
    layer.setAttribute('data-nav-layer', 'page');
    layer.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const play = place(layer, 'play', 400, 300);
    const similar = place(layer, 'similar', 400, 500);

    const mesures: Element[] = [];
    for (const el of [...cachees, underneath]) {
      const lire = el.getBoundingClientRect.bind(el);
      el.getBoundingClientRect = () => { mesures.push(el); return lire(); };
    }
    const styles = vi.spyOn(window, 'getComputedStyle');

    try {
      expect(findNextFocusable(play, 'down')).toBe(similar);
      expect(findNextFocusable(play, 'left')).toBe(home);
      // Seuls le calque, ses éléments et la barre latérale sont lus ; la page dessous jamais
      expect(mesures).toEqual([]);
      expect(styles.mock.calls.some(([el]) => cachees.includes(el as HTMLElement))).toBe(false);
    } finally {
      styles.mockRestore();
    }
  });

  it('un piège ne mesure pas non plus ce qui est hors du piège', () => {
    const trap = zone();
    trap.setAttribute('data-nav-trap', '');
    const inside = place(trap, 'trap-a', 0, 0);
    const insideB = place(trap, 'trap-b', 150, 0);
    const outside = Array.from({ length: 10 }, (_, i) => place(zone(), `outside-${i}`, 400, 100 * i));
    const mesures: Element[] = [];
    for (const el of outside) {
      const lire = el.getBoundingClientRect.bind(el);
      el.getBoundingClientRect = () => { mesures.push(el); return lire(); };
    }
    expect(findNextFocusable(inside, 'right')).toBe(insideB);
    expect(mesures).toEqual([]);
  });
});

describe('connexion, appui long, faisceau', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installSpatialNavigation();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function at<T extends HTMLElement>(el: T, x: number, y: number, w = 100, h = 60): T {
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
    el.scrollIntoView = () => {};
    return el;
  }

  function input(type: string, x: number, y: number, w = 100, h = 60): HTMLInputElement {
    const el = document.createElement('input');
    el.type = type;
    return at(el, x, y, w, h);
  }

  const key = (target: Element, type: string, k: string, repeat = false) => {
    const event = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, repeat });
    target.dispatchEvent(event);
    return event;
  };

  it('petite case sous un large champ : atteinte avant un bouton mieux centré plus bas', () => {
    const confirm = input('password', 0, 0, 380, 56);
    const checkbox = input('checkbox', 4, 76, 13, 13);
    at(document.createElement('button'), 50, 120, 280, 52);
    expect(findNextFocusable(confirm, 'down')).toBe(checkbox);
  });

  it('champ texte rempli : Bas le quitte (on pouvait rester bloqué après avoir tapé l\'e-mail)', () => {
    const email = input('email', 0, 0, 380, 56);
    email.value = 'nom@exemple.fr';
    const password = input('password', 0, 100, 380, 56);
    email.focus();
    key(email, 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(password);
  });

  it('case à cocher : Bas la quitte et OK la coche', () => {
    const checkbox = input('checkbox', 0, 0, 13, 13);
    const submit = at(document.createElement('button'), 0, 60);
    checkbox.focus();
    key(checkbox, 'keydown', 'Enter');
    expect(checkbox.checked).toBe(true);
    key(checkbox, 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(submit);
  });

  it('OK maintenu : les répétitions ne rejouent aucune action', () => {
    const button = at(document.createElement('button'), 0, 0);
    button.focus();
    const repeat = key(button, 'keydown', 'Enter', true);
    expect(repeat.defaultPrevented).toBe(true);
  });

  it('appui long passif (mot de passe) : appui natif conservé, envoi implicite bloqué', () => {
    const password = input('password', 0, 0);
    password.setAttribute('data-nav-longpress', 'passive');
    let toggled = 0;
    password.addEventListener('nyx:longpress', () => { toggled += 1; });
    password.focus();

    vi.useFakeTimers();
    const down = key(password, 'keydown', 'Enter');
    const press = key(password, 'keypress', 'Enter');
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    key(password, 'keyup', 'Enter');
    vi.useRealTimers();

    expect(down.defaultPrevented).toBe(false);
    expect(press.defaultPrevented).toBe(true);
    expect(toggled).toBe(1);
  });
});

describe('champ de texte : sortie latérale (page Recherche)', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installSpatialNavigation();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function place<T extends HTMLElement>(el: T, x: number, y: number, w = 100, h = 60): T {
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
    el.scrollIntoView = () => {};
    return el;
  }

  function setup() {
    const sidebar = document.createElement('div');
    sidebar.setAttribute('data-nav-zone', 'sidebar');
    document.body.appendChild(sidebar);
    const home = document.createElement('button');
    sidebar.appendChild(home);
    place(home, 0, 0, 56, 56);
    const search = document.createElement('input');
    search.type = 'text';
    place(search, 300, 0, 400, 56);
    search.focus();
    return { home, search };
  }

  const left = (target: Element) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

  it('champ vide : Gauche rejoint la barre latérale', () => {
    const { home, search } = setup();
    left(search);
    expect(document.activeElement).toBe(home);
  });

  it('texte saisi : Gauche déplace le curseur, puis sort une fois en début de champ', () => {
    const { home, search } = setup();
    search.value = 'dune';
    search.setSelectionRange(2, 2);
    left(search);
    expect(document.activeElement).toBe(search);
    search.setSelectionRange(0, 0);
    left(search);
    expect(document.activeElement).toBe(home);
  });
});

describe('flèche maintenue : vitesse de déplacement limitée', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installSpatialNavigation();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  function column(count: number): HTMLButtonElement[] {
    return Array.from({ length: count }, (_, i) => {
      const button = document.createElement('button');
      document.body.appendChild(button);
      button.getBoundingClientRect = () =>
        ({ left: 0, top: i * 80, right: 100, bottom: i * 80 + 60, width: 100, height: 60, x: 0, y: i * 80, toJSON: () => ({}) }) as DOMRect;
      button.scrollIntoView = () => {};
      return button;
    });
  }

  const down = (repeat: boolean) =>
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', repeat, bubbles: true, cancelable: true }));

  it('les répétitions rapprochées sont ignorées, un déplacement toutes les HELD_VERTICAL_STEP_MS', () => {
    vi.useFakeTimers();
    const buttons = column(5);
    buttons[0].focus();
    down(false);
    expect(document.activeElement).toBe(buttons[1]);
    down(true);
    expect(document.activeElement).toBe(buttons[2]);
    down(true);
    down(true);
    expect(document.activeElement).toBe(buttons[2]);
    vi.advanceTimersByTime(HELD_VERTICAL_STEP_MS);
    down(true);
    expect(document.activeElement).toBe(buttons[3]);
  });
});

describe('clavier à la demande (TV) : arriver sur un champ ne l\'ouvre pas, OK l\'ouvre', () => {
  let uninstall: () => void = () => {};

  beforeEach(() => {
    document.body.innerHTML = '';
    uninstall = installSpatialNavigation();
  });

  afterEach(() => {
    uninstall();
    document.body.innerHTML = '';
  });

  function at<T extends HTMLElement>(el: T, x: number, y: number, w = 100, h = 60): T {
    document.body.appendChild(el);
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
    el.scrollIntoView = () => {};
    return el;
  }

  const key = (target: Element, type: string, k: string) => {
    const event = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };

  it('arrivée par les flèches : champ en lecture seule, OK le rend modifiable sans bloquer l\'effet natif', () => {
    const top = at(document.createElement('button'), 0, 0);
    const field = at(document.createElement('input'), 0, 100);
    let pageSawEnter = false;
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') pageSawEnter = true; });
    top.focus();
    key(top, 'keydown', 'ArrowDown');
    expect(document.activeElement).toBe(field);
    expect(field.readOnly).toBe(true);

    const ok = key(field, 'keydown', 'Enter');
    expect(field.readOnly).toBe(false);
    // Android ouvre le clavier par l'effet natif de la touche : il ne doit pas être empêché
    expect(ok.defaultPrevented).toBe(false);
    // Ce premier appui ne valide rien (la Recherche se refermait sur Entrée)
    expect(pageSawEnter).toBe(false);
  });

  it('champ quitté puis retrouvé : de nouveau sans clavier ; un toucher le rend modifiable', () => {
    const top = at(document.createElement('button'), 0, 0);
    const field = at(document.createElement('input'), 0, 100);
    top.focus();
    key(top, 'keydown', 'ArrowDown');
    key(field, 'keydown', 'Enter');
    expect(field.readOnly).toBe(false);

    key(field, 'keydown', 'ArrowUp');
    expect(document.activeElement).toBe(top);
    key(top, 'keydown', 'ArrowDown');
    expect(field.readOnly).toBe(true);

    field.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(field.readOnly).toBe(false);
  });

  it('un champ en lecture seule par nature le reste', () => {
    const top = at(document.createElement('button'), 0, 0);
    const field = at(document.createElement('input'), 0, 100);
    field.readOnly = true;
    top.focus();
    key(top, 'keydown', 'ArrowDown');
    key(field, 'keydown', 'Enter');
    expect(field.readOnly).toBe(true);
  });
});

describe('Paramètres à la télécommande (Chromecast)', () => {
  const rect = (el: HTMLElement, x: number, y: number, w = 100, h = 60): void => {
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('un interrupteur (case transparente sous son dessin) est atteignable', () => {
    const current = button('categories', 0, 0);
    const label = document.createElement('label');
    label.className = 'toggle-switch';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.style.opacity = '0';
    label.appendChild(toggle);
    document.body.appendChild(label);
    rect(toggle, 0, 200, 48, 26);
    expect(findNextFocusable(current, 'down')).toBe(toggle);
  });

  it('une fenêtre de confirmation garde la sélection : rien derrière elle', () => {
    const behind = button('modifier', 0, 0);
    const backdrop = document.createElement('div');
    backdrop.setAttribute('data-nav-layer', 'modal');
    document.body.appendChild(backdrop);
    rect(backdrop, 0, 0, 1280, 720);
    const cancel = document.createElement('button');
    const confirm = document.createElement('button');
    backdrop.append(cancel, confirm);
    rect(cancel, 400, 300);
    rect(confirm, 600, 300);
    expect(findNextFocusable(cancel, 'right')).toBe(confirm);
    expect(findNextFocusable(cancel, 'up')).toBeNull();
    expect(findNextFocusable(confirm, 'left')).toBe(cancel);
    expect(behind.isConnected).toBe(true);
  });
});

describe('lecteur à la télécommande (Chromecast)', () => {
  const rect = (el: HTMLElement, x: number, y: number, w = 100, h = 60): void => {
    el.getBoundingClientRect = () =>
      ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  /** Lecteur en direct : calque du lecteur, boutons en bas, liste de chaînes fermée hors de l'écran */
  function livePlayer(switcherOpen: boolean) {
    const player = document.createElement('div');
    player.setAttribute('data-nav-layer', 'modal');
    document.body.appendChild(player);
    rect(player, 0, 0, 1280, 720);
    const play = document.createElement('button');
    const channels = document.createElement('button');
    player.append(play, channels);
    rect(play, 40, 640, 50, 50);
    rect(channels, 580, 640, 120, 50);
    // Liste fermée : glissée à gauche, transparente sur le panneau, pas sur ses boutons
    const switcher = document.createElement('div');
    if (!switcherOpen) switcher.setAttribute('inert', '');
    const categories = document.createElement('aside');
    categories.setAttribute('data-nav-zone', 'aside');
    const category = document.createElement('button');
    categories.appendChild(category);
    const card = document.createElement('div');
    card.setAttribute('role', 'button');
    card.tabIndex = 0;
    switcher.append(categories, card);
    player.appendChild(switcher);
    rect(category, -230, 600, 220, 50);
    rect(card, -50, 560, 260, 120);
    return { play, channels, category, card };
  }

  it('liste de chaînes fermée : ses boutons hors de l\'écran ne prennent plus le focus', () => {
    const { play, channels } = livePlayer(false);
    // Avant : Gauche depuis Lecture entrait dans la barre des catégories cachée
    expect(findNextFocusable(play, 'left')).toBeNull();
    expect(findNextFocusable(channels, 'left')).toBe(play);
  });

  it('liste de chaînes ouverte : ses boutons redeviennent atteignables', () => {
    const { play, card } = livePlayer(true);
    expect(findNextFocusable(play, 'up')).toBe(card);
  });

  it('fenêtre de vitesse ouverte : la sélection y reste', () => {
    const { channels } = livePlayer(false);
    const menu = document.createElement('div');
    menu.setAttribute('data-nav-layer', 'modal');
    const slow = document.createElement('div');
    const fast = document.createElement('div');
    for (const item of [slow, fast]) {
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
    }
    menu.append(slow, fast);
    channels.parentElement!.appendChild(menu);
    rect(menu, 1000, 400, 120, 200);
    rect(slow, 1000, 400, 120, 50);
    rect(fast, 1000, 460, 120, 50);
    expect(findNextFocusable(slow, 'down')).toBe(fast);
    expect(findNextFocusable(fast, 'down')).toBeNull();
    expect(findNextFocusable(slow, 'left')).toBeNull();
  });

  it('curseur (taille des sous-titres) : Gauche / Droite changent sa valeur au lieu de le quitter', () => {
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.appendChild(slider);
    rect(slider, 200, 300, 200, 20);
    const left = button('left', 0, 290);
    const above = button('above', 200, 100);
    above.scrollIntoView = () => {};
    slider.focus();

    const uninstall = installSpatialNavigation();
    const sideways = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    slider.dispatchEvent(sideways);
    expect(document.activeElement).toBe(slider);
    expect(sideways.defaultPrevented).toBe(false); // l'effet natif déplace le curseur
    slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(above);
    expect(left.isConnected).toBe(true);
    uninstall();
  });
});
