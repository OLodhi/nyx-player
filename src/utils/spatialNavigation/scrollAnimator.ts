/**
 * Un seul défilement animé par zone et par axe, qui change de cible en route.
 *
 * Avec `scrollIntoView({ behavior: 'smooth' })`, un second appui lance
 * une seconde animation par-dessus la première (la vue repart en arrière, puis saute). La règle des
 * 0,35 s qui supprimait l'animation du second appui (désormais retirée) ôtait la saccade, mais
 * téléportait la vue. Ici, on conduit le défilement image par image : un nouvel appui change seulement la
 * cible, et l'animation repart de la position et de la vitesse du moment, sans à-coup. Touche
 * maintenue : la vue suit la sélection d'un mouvement continu, sans animation à empiler.
 * (Même principe que Leanback, Compose `BringIntoViewSpec` et les transitions de Lightning.)
 *
 * Courbe : ressort à amortissement critique vers la cible. Changer la cible ne change ni la position ni la
 * vitesse du moment : l'animation repart de là, sans à-coup.
 * Le temps vient de l'horloge, pas du nombre d'images : une image perdue ne ralentit pas l'animation.
 */

import { isTv } from '../platform';

type Axis = 'top' | 'left';

interface AxisState {
  /** Position et vitesse (px/ms) au début du tronçon en cours */
  p0: number;
  v0: number;
  target: number;
  t0: number;
  /** Raideur de ce tronçon */
  omega: number;
  /** Dernière valeur écrite : un écart au relevé suivant est un déplacement venu d'ailleurs */
  last: number;
  /** Tronçon joué par le compositeur : la zone est déjà à la cible (`playVerticalOnCompositor`) */
  compositor?: boolean;
}

/**
 * Raideur du ressort (par ms), amortissement critique : jamais de rebond. Un appui de 400 px fait
 * l'essentiel du chemin en 0,3 s (la fin s'étire, comme tout ralentissement) ; une touche maintenue (un pas
 * toutes les 200 ms) donne une vitesse presque constante, la vue suivant la sélection avec un léger retard.
 */
export const SPRING_OMEGA = 0.012;
/** Cible changée en route (touche maintenue) : plus raide, pour que la sélection reste près du centre. */
export const RETARGET_OMEGA = 0.014;
/** Arrivée : reste à parcourir et vitesse sous lesquels on écrit la cible exacte. */
const ARRIVAL_PX = 1;
const ARRIVAL_SPEED = 0.05;
/** Écart toléré entre ce qu'on a écrit et ce qu'on relit (arrondis, ancrage du défilement). */
const DRIFT_PX = 2;
/** Reste à parcourir en dessous duquel on écrit directement. */
const MIN_TRAVEL_PX = 1;

const states = new WeakMap<HTMLElement, Partial<Record<Axis, AxisState>>>();
const running = new Set<HTMLElement>();
let frame: number | null = null;
/** Rappels qui attendent la fin de toutes les animations (`whenScrollSettled`). */
const settledCallbacks = new Set<() => void>();

/** Raideur des ressorts en défilement léger : le mouvement finit environ 1,5 fois plus tôt. */
export const LIGHT_SPRING_SCALE = 1.5;

/**
 * Défilement animé léger, le réglage de la TV : ressorts plus courts, et ce qui doit se monter attend la fin du
 * mouvement (`deferWhileScrolling`) au lieu de le couper. Monter une rangée bloque une petite télé 150 à 180 ms : en
 * plein mouvement, autant d'images perdues.
 */
export function isLightScroll(): boolean {
  // TV lue à l'usage : la plateforme est détectée après le chargement de ce module
  return isTv();
}

/**
 * Attente maximale d'un montage remis à la fin du mouvement : une touche maintenue ne le laisse jamais finir. À
 * 350 ms, un appui de 400 px n'a plus que 5 px à parcourir (au ressort léger) : l'arrêt du montage ne se voit presque plus.
 */
export const DEFERRED_MOUNT_MAX_MS = 350;

/**
 * Défilement léger : lance `run` à la fin du mouvement en cours, au plus tard après `DEFERRED_MOUNT_MAX_MS`.
 * Sinon (ou sans mouvement), tout de suite. Renvoie l'annulation.
 */
export function deferWhileScrolling(run: () => void): () => void {
  if (running.size === 0 || !isLightScroll()) {
    run();
    return () => undefined;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    cancelSettled();
    run();
  };
  const timer = setTimeout(once, DEFERRED_MOUNT_MAX_MS);
  // Fin du mouvement : après l'affichage de la dernière image, pas pendant son calcul
  let settledTimer: ReturnType<typeof setTimeout> | undefined;
  const stopSettled = whenScrollSettled(() => {
    settledTimer = setTimeout(once, 0);
  });
  const cancelSettled = () => {
    stopSettled();
    clearTimeout(settledTimer);
  };
  return () => {
    done = true;
    clearTimeout(timer);
    cancelSettled();
  };
}

/** Une animation de défilement est-elle en cours ? */
export function isScrollAnimating(): boolean {
  return running.size > 0;
}

/**
 * Appelle `callback` quand plus aucune animation de défilement ne tourne (tout de suite s'il n'y en a pas).
 * Renvoie l'annulation.
 */
export function whenScrollSettled(callback: () => void): () => void {
  if (running.size === 0) {
    callback();
    return () => undefined;
  }
  settledCallbacks.add(callback);
  return () => {
    settledCallbacks.delete(callback);
  };
}

function flushSettled(): void {
  if (running.size > 0 || settledCallbacks.size === 0) return;
  const callbacks = [...settledCallbacks];
  settledCallbacks.clear();
  for (const callback of callbacks) callback();
}

// ---------------------------------------------------------------------------
// Défilement vertical joué par le compositeur
// ---------------------------------------------------------------------------

/**
 * Zones dont le défilement vertical est joué par le compositeur du navigateur, avec le nombre de demandes en cours.
 *
 * Écrit par le script à chaque image, le défilement s'arrête dès que le script est occupé (une flèche, une rangée
 * construite) : sur une petite télé, touche maintenue, la moitié des images n'étaient pas prêtes à temps. Ici, la
 * même courbe est confiée au compositeur, qui continue de faire bouger l'écran pendant ce temps : la zone saute tout
 * de suite à la cible (`scrollTop`), et ses enfants partent du décalage inverse (propriété `translate`) pour revenir
 * à 0 en suivant le ressort, échantillonné toutes les 16 ms.
 *
 * À réserver aux zones dont le contenu ne change pas de hauteur pendant le mouvement : la cible est posée au départ,
 * un ancrage du défilement (rangée de hauteur différente montée au-dessus) ne serait plus suivi et ferait sauter la
 * vue à l'arrivée.
 */
const compositorZones = new Map<HTMLElement, number>();
const COMPOSITOR_STEP_MS = 16;
/** Durée maximale d'une courbe confiée au compositeur (un ressort arrive bien avant) */
const COMPOSITOR_MAX_MS = 3000;
/** Animations en cours, par zone : une par enfant */
const compositorAnimations = new Map<HTMLElement, Animation[]>();

/** WebView qui sait animer la propriété `translate` (Chrome 104 et plus) ; sinon, le défilement reste écrit par le script. */
function compositorSupported(el: HTMLElement): boolean {
  return typeof el.animate === 'function' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('translate', '0 1px');
}

/**
 * Le défilement vertical de `el` est joué par le compositeur tant que la demande n'est pas rendue (la fonction
 * renvoyée la rend). Sans effet là où la WebView ne sait pas le faire.
 */
export function playVerticalOnCompositor(el: HTMLElement): () => void {
  compositorZones.set(el, (compositorZones.get(el) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (compositorZones.get(el) ?? 1) - 1;
    if (count > 0) {
      compositorZones.set(el, count);
      return;
    }
    compositorZones.delete(el);
    // Un tronçon en cours se finit sur place, à la position vue à l'écran
    if (states.get(el)?.top?.compositor) stop(el);
  };
}

/**
 * Instant de la courbe réellement montré : l'animation démarre une ou deux images après sa demande, l'horloge du
 * script la devancerait d'autant (jusqu'à 50 px d'écart en pleine vitesse).
 */
function compositorTime(el: HTMLElement, state: AxisState): number {
  const time = compositorAnimations.get(el)?.[0]?.currentTime;
  return state.t0 + (typeof time === 'number' ? time : 0);
}

/** Position verticale vue à l'écran : celle de la courbe pendant un tronçon joué par le compositeur. */
export function visualScrollTop(el: HTMLElement): number {
  const state = states.get(el)?.top;
  return state?.compositor ? sample(state, compositorTime(el, state)).p : el.scrollTop;
}

function stopCompositor(el: HTMLElement): void {
  for (const animation of compositorAnimations.get(el) ?? []) animation.cancel();
  compositorAnimations.delete(el);
}

/** Confie au compositeur la courbe du tronçon, en décalages des enfants de la zone (déjà à la cible). */
function startCompositor(el: HTMLElement, state: AxisState): void {
  stopCompositor(el);
  const frames: Keyframe[] = [];
  for (let dt = 0; ; dt += COMPOSITOR_STEP_MS) {
    const { p, done } = sample(state, state.t0 + dt);
    frames.push({ translate: `0 ${done ? 0 : state.target - p}px` });
    if (done || dt >= COMPOSITOR_MAX_MS) break;
  }
  if (frames.length < 2) return;
  const duration = (frames.length - 1) * COMPOSITOR_STEP_MS;
  compositorAnimations.set(el, Array.from(el.children, (child) => child.animate(frames, { duration, easing: 'linear' })));
}

const now = (): number => performance.now();
const prop = (axis: Axis): 'scrollTop' | 'scrollLeft' => (axis === 'top' ? 'scrollTop' : 'scrollLeft');

function maxScroll(el: HTMLElement, axis: Axis): number {
  return Math.max(0, axis === 'top' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);
}

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Position et vitesse (px/ms) à l'instant `t` : ressort à amortissement critique vers la cible, en partant de
 * la position et de la vitesse du tronçon. Solution exacte : ne dépend pas du nombre d'images.
 */
function sample(state: AxisState, t: number): { p: number; v: number; done: boolean } {
  const dt = Math.max(0, t - state.t0);
  const x0 = state.p0 - state.target;
  const w = state.omega;
  const b = state.v0 + w * x0;
  const decay = Math.exp(-w * dt);
  const x = (x0 + b * dt) * decay;
  const v = (state.v0 - w * b * dt) * decay;
  if (Math.abs(x) < ARRIVAL_PX && Math.abs(v) < ARRIVAL_SPEED) return { p: state.target, v: 0, done: true };
  return { p: state.target + x, v, done: false };
}

function stateOf(el: HTMLElement): Partial<Record<Axis, AxisState>> {
  let s = states.get(el);
  if (!s) {
    s = {};
    states.set(el, s);
  }
  return s;
}

function stop(el: HTMLElement): void {
  const top = states.get(el)?.top;
  // Arrêt en route d'un tronçon joué par le compositeur : la zone reprend la position vue à l'écran
  if (top?.compositor) {
    const { p, done } = sample(top, compositorTime(el, top));
    if (!done) el.scrollTop = Math.round(p);
  }
  stopCompositor(el);
  states.delete(el);
  running.delete(el);
  if (running.size === 0) {
    stopLoop();
    flushSettled();
  }
}

function startLoop(): void {
  if (frame !== null) return;
  document.addEventListener('wheel', cancelAllScrolls, { capture: true, passive: true });
  document.addEventListener('pointerdown', cancelAllScrolls, { capture: true, passive: true });
  frame = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  document.removeEventListener('wheel', cancelAllScrolls, { capture: true });
  document.removeEventListener('pointerdown', cancelAllScrolls, { capture: true });
}

function tick(): void {
  frame = null;
  const t = now();
  // Lectures d'abord, écritures ensuite : pas de mise en page forcée entre deux conteneurs. Seul l'axe qui bouge est
  // lu : chaque lecture de taille ou de position coûte, et une zone ne défile presque toujours que sur un axe
  const reads = [...running].map((el) => {
    const s = states.get(el);
    return {
      el,
      // Tronçon joué par le compositeur : rien à relire, la zone est déjà à la cible
      top: s?.top && !s.top.compositor ? { max: maxScroll(el, 'top'), pos: el.scrollTop } : null,
      left: s?.left ? { max: maxScroll(el, 'left'), pos: el.scrollLeft } : null,
    };
  });
  for (const { el, ...read } of reads) {
    const s = states.get(el);
    if (!s || !el.isConnected) {
      stop(el);
      continue;
    }
    if (s.top?.compositor && sample(s.top, compositorTime(el, s.top)).done) {
      // Fin de la courbe jouée par le compositeur : rien à écrire
      delete s.top;
      compositorAnimations.delete(el);
    }
    for (const axis of ['top', 'left'] as const) {
      const a = s[axis];
      const measured = read[axis];
      if (!a || !measured) continue;
      const { max, pos } = measured;
      // Déplacement venu d'ailleurs (ancrage du défilement quand des rangées se montent au-dessus) :
      // la courbe et la cible suivent le même décalage
      const drift = pos - a.last;
      if (Math.abs(drift) > DRIFT_PX) {
        a.p0 += drift;
        a.target += drift;
      }
      a.target = Math.min(max, Math.max(0, a.target));
      const { p, done } = sample(a, t);
      const value = done ? a.target : Math.round(p);
      el[prop(axis)] = value;
      a.last = value;
      if (done) delete s[axis];
    }
    if (!s.top && !s.left) stop(el);
  }
  if (running.size > 0 && frame === null) frame = requestAnimationFrame(tick);
}

/**
 * Fait défiler `el` vers `target` (pixels de défilement de chaque axe). Une animation en cours est
 * redirigée : elle garde sa position et sa vitesse. `instant` : on écrit tout de suite.
 */
export function animateScrollTo(
  el: HTMLElement,
  target: { top?: number; left?: number },
  options: { instant?: boolean } = {},
): void {
  const direct = options.instant || reducedMotion() || (typeof document !== 'undefined' && document.hidden);
  const t = now();
  for (const axis of ['top', 'left'] as const) {
    const wanted = target[axis];
    if (wanted === undefined) continue;
    const to = Math.min(maxScroll(el, axis), Math.max(0, wanted));
    const s = states.get(el);
    const current = s?.[axis];
    if (direct) {
      if (current?.compositor) stopCompositor(el);
      if (current) delete s[axis];
      el[prop(axis)] = to;
      continue;
    }
    let p = el[prop(axis)];
    let v = 0;
    if (current) {
      const sampled = sample(current, current.compositor ? compositorTime(el, current) : t);
      p = sampled.p;
      v = sampled.v;
    }
    const delta = to - p;
    if (Math.abs(delta) < MIN_TRAVEL_PX) {
      if (current?.compositor) stopCompositor(el);
      if (current) delete s[axis];
      el[prop(axis)] = to;
      continue;
    }
    // Jamais de recul : une vitesse qui va à l'opposé de la cible est annulée, et trop grande pour la
    // distance restante elle ferait dépasser la cible au ressort
    if (v * delta < 0) v = 0;
    const omega = (current ? RETARGET_OMEGA : SPRING_OMEGA) * (isLightScroll() ? LIGHT_SPRING_SCALE : 1);
    const cap = omega * Math.abs(delta);
    if (Math.abs(v) > cap) v = Math.sign(v) * cap;
    // `last` : ce qui est réellement affiché, pas la position de la courbe (qui est en avance d'une image)
    const state: AxisState = { p0: p, v0: v, target: to, t0: t, omega, last: el[prop(axis)] };
    stateOf(el)[axis] = state;
    if (axis === 'top' && compositorZones.has(el) && compositorSupported(el)) {
      state.compositor = true;
      el.scrollTop = to;
      state.last = to;
      startCompositor(el, state);
    }
    running.add(el);
  }
  const s = states.get(el);
  if (s && !s.top && !s.left) stop(el);
  else if (running.has(el)) startLoop();
  if (running.size === 0 && frame !== null) stopLoop();
  flushSettled();
}

/** Ajoute `by` à la cible en cours (ou à la position, sans animation en cours). */
export function animateScrollBy(el: HTMLElement, by: { top?: number; left?: number }): void {
  const pending = states.get(el);
  const target: { top?: number; left?: number } = {};
  for (const axis of ['top', 'left'] as const) {
    const delta = by[axis];
    if (delta === undefined) continue;
    target[axis] = (pending?.[axis]?.target ?? el[prop(axis)]) + delta;
  }
  animateScrollTo(el, target);
}

/** Saute tout de suite à la cible en cours (avant une mesure qui doit se faire à l'arrivée). */
export function settleScroll(el: HTMLElement): void {
  const s = states.get(el);
  if (!s) return;
  for (const axis of ['top', 'left'] as const) {
    const a = s[axis];
    if (a) el[prop(axis)] = Math.min(maxScroll(el, axis), a.target);
    // Déjà à la cible : `stop` ne doit pas revenir à la position vue à l'écran
    if (a) delete a.compositor;
  }
  stop(el);
}

/** Arrête l'animation de `el` sur place. */
export function cancelScroll(el: HTMLElement): void {
  stop(el);
}

export function cancelAllScrolls(): void {
  // Molette ou clic : un tronçon joué par le compositeur saute à sa cible (la zone y est déjà)
  for (const el of [...running]) {
    stopCompositor(el);
    states.delete(el);
  }
  running.clear();
  stopLoop();
  flushSettled();
}

// ---------------------------------------------------------------------------
// Cible : ce que `scrollIntoView({ block, inline })` ferait, sans le faire
// ---------------------------------------------------------------------------

export interface RevealTarget {
  container: HTMLElement;
  top?: number;
  left?: number;
}

type Align = 'center' | 'nearest';

function scrollsOn(style: CSSStyleDeclaration, axis: Axis): boolean {
  const overflow = axis === 'top' ? style.overflowY : style.overflowX;
  return overflow === 'auto' || overflow === 'scroll';
}

const px = (value: string): number => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** Réduction d'un conteneur à l'écran (taille vue ÷ taille de mise en page) ; 1 si elle ne se mesure pas. */
export function screenScale(seen: number, layout: number): number {
  return layout > 0 && seen > 0 ? seen / layout : 1;
}

/** Déplacement de défilement qui amène [start, end] dans la zone visible [from, to]. */
function delta(align: Align, start: number, end: number, from: number, to: number): number {
  if (align === 'center') return (start + end) / 2 - (from + to) / 2;
  if (start >= from && end <= to) return 0;
  if (end - start >= to - from) return start - from;
  return start < from ? start - from : end - to;
}

/**
 * Pour chaque ancêtre qui défile (carrousel en x, page en y, corps du guide en x et y) : la position
 * de défilement qui place l'élément comme `scrollIntoView` le ferait. Les déplacements des conteneurs
 * intérieurs sont déjà pris en compte pour les extérieurs, dans le même ordre que le natif.
 *
 * Deux repères : les rectangles sont mesurés à l'écran, alors que tailles, marges et défilement sont
 * en pixels de mise en page. Les deux coïncident tant qu'aucun ancêtre n'est réduit (cas actuel) ; la
 * page TV a déjà été réduite à 0,9 au centre, et sans conversion la zone visible d'un
 * carrousel débordait de 10 % à droite (banc, géométrie TV, Recherche). La conversion reste, sans effet
 * à l'échelle 1.
 */
export function computeRevealTargets(el: HTMLElement, align: { block: Align; inline: Align }): RevealTarget[] {
  const rect = el.getBoundingClientRect();
  let top = rect.top;
  let bottom = rect.bottom;
  let left = rect.left;
  let right = rect.right;
  let fixedChecked: HTMLElement | null = el; // dernier élément de la chaîne dont la position est connue
  let margins = false; // `scroll-margin` de l'élément : lu une fois, au premier conteneur qui défile
  const result: RevealTarget[] = [];
  for (let node = el.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    // Dimensions d'abord (lecture bon marché) : le style calculé n'est lu que pour les zones qui débordent
    const overflowsY = node.scrollHeight > node.clientHeight + 1;
    const overflowsX = node.scrollWidth > node.clientWidth + 1;
    if (!overflowsY && !overflowsX) continue;
    const style = getComputedStyle(node);
    const canY = overflowsY && scrollsOn(style, 'top');
    const canX = overflowsX && scrollsOn(style, 'left');
    if (!canY && !canX) continue;
    // Comme le natif, on s'arrête à une fenêtre fixe (confirmation, calque) : la page derrière ne bouge pas
    let fixed = false;
    for (let n: HTMLElement | null = fixedChecked; n && n !== node; n = n.parentElement) {
      if (getComputedStyle(n).position === 'fixed') fixed = true;
    }
    fixedChecked = node;
    if (fixed) break;
    const box = node.getBoundingClientRect();
    // Pixels d'écran par pixel de mise en page (1 sans réduction, 0,9 sur TV)
    const sx = screenScale(box.width, node.offsetWidth);
    const sy = screenScale(box.height, node.offsetHeight);
    if (!margins) {
      const own = getComputedStyle(el);
      top -= px(own.scrollMarginTop) * sy;
      bottom += px(own.scrollMarginBottom) * sy;
      left -= px(own.scrollMarginLeft) * sx;
      right += px(own.scrollMarginRight) * sx;
      margins = true;
    }
    const target: RevealTarget = { container: node };
    if (canY) {
      const from = box.top + (node.clientTop + px(style.scrollPaddingTop)) * sy;
      const to = box.top + (node.clientTop + node.clientHeight - px(style.scrollPaddingBottom)) * sy;
      // Tronçon joué par le compositeur : l'écran montre la position de la courbe, pas encore `scrollTop`
      const seen = visualScrollTop(node);
      const wanted = Math.min(maxScroll(node, 'top'), Math.max(0, seen + delta(align.block, top, bottom, from, to) / sy));
      const moved = (wanted - seen) * sy;
      target.top = wanted;
      top -= moved;
      bottom -= moved;
    }
    if (canX) {
      const from = box.left + (node.clientLeft + px(style.scrollPaddingLeft)) * sx;
      const to = box.left + (node.clientLeft + node.clientWidth - px(style.scrollPaddingRight)) * sx;
      const wanted = Math.min(maxScroll(node, 'left'), Math.max(0, node.scrollLeft + delta(align.inline, left, right, from, to) / sx));
      const moved = (wanted - node.scrollLeft) * sx;
      target.left = wanted;
      left -= moved;
      right -= moved;
    }
    result.push(target);
  }
  return result;
}
