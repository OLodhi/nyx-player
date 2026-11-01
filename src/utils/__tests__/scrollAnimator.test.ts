/**
 * Défilement conduit : un seul mouvement par zone, qui change de cible en
 * route en gardant sa position et sa vitesse. Horloge simulée : le temps vient de `performance.now()`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  animateScrollBy,
  animateScrollTo,
  cancelAllScrolls,
  cancelScroll,
  computeRevealTargets,
  DEFERRED_MOUNT_MAX_MS,
  deferWhileScrolling,
  settleScroll,
} from '../spatialNavigation/scrollAnimator';
import { setTvMode } from '../platform';

const FRAME_MS = 16;
/** Temps largement suffisant pour qu'un mouvement de quelques centaines de pixels arrive. */
const SETTLE_MS = 1200;

/** Zone qui défile : `scrollTop` modifiable, taille du contenu et de la fenêtre fixées. */
function zone(scrollHeight = 5000, clientHeight = 720): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let position = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight });
  return el;
}

/** Fait avancer l'horloge image par image et relève la position à chaque image. */
function run(el: HTMLElement, ms: number): number[] {
  const seen: number[] = [];
  for (let t = 0; t < ms; t += FRAME_MS) {
    vi.advanceTimersByTime(FRAME_MS);
    seen.push(el.scrollTop);
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  document.body.innerHTML = '';
});

afterEach(() => {
  setTvMode(false);
  cancelAllScrolls();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('animation du défilement', () => {
  it('un appui seul : arrivée exacte, toujours en avançant, sans rebond', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    const seen = run(el, SETTLE_MS);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThan(600);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(el.scrollTop).toBe(600);
    // Rien ne reste planifié une fois arrivé
    expect(vi.getTimerCount()).toBe(0);
  });

  it('défilement vertical : l\'axe horizontal n\'est jamais lu (chaque lecture peut forcer une mise en page)', () => {
    const el = zone();
    const horizontal = vi.fn(() => 0);
    Object.defineProperty(el, 'scrollLeft', { get: horizontal, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { get: horizontal, configurable: true });
    Object.defineProperty(el, 'clientWidth', { get: horizontal, configurable: true });
    animateScrollTo(el, { top: 600 });
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(600);
    expect(horizontal).not.toHaveBeenCalled();
  });

  it('cible changée en route : la position ne saute pas et la vitesse reste continue', () => {
    const el = zone();
    animateScrollTo(el, { top: 500 });
    run(el, 128);
    const before = el.scrollTop;
    // Vitesse juste avant le changement : écart sur une image
    const p1 = el.scrollTop;
    run(el, FRAME_MS);
    const p2 = el.scrollTop;
    const perFrameBefore = p2 - p1;

    animateScrollTo(el, { top: 900 });
    expect(el.scrollTop).toBe(p2); // aucun saut au changement de cible
    const after = run(el, 2 * FRAME_MS);
    const perFrameAfter = after[0] - p2;
    expect(Math.abs(perFrameAfter - perFrameBefore)).toBeLessThanOrEqual(perFrameBefore * 0.5 + 2);
    expect(before).toBeGreaterThan(0);
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(900);
  });

  it('cible dans l\'autre sens : la vue ne repart pas en arrière avant de revenir', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    run(el, 128);
    const turning = el.scrollTop;
    animateScrollTo(el, { top: 100 });
    const seen = run(el, SETTLE_MS);
    // Jamais au-delà de ce qu'elle avait atteint, et descend vers la cible sans osciller
    expect(Math.max(...seen)).toBeLessThanOrEqual(turning + 1);
    expect(seen.every((v, i) => i === 0 || v <= seen[i - 1])).toBe(true);
    expect(el.scrollTop).toBe(100);
  });

  it('touche maintenue (un pas toutes les 200 ms) : vitesse régulière, jamais de recul ni de saut d\'un pas', () => {
    const el = zone(20000);
    const step = 400;
    let target = 0;
    const speeds: number[] = [];
    let last = 0;
    for (let press = 0; press < 10; press++) {
      target += step;
      animateScrollTo(el, { top: target });
      const seen = run(el, 200);
      for (const v of seen) {
        speeds.push(v - last);
        last = v;
      }
    }
    expect(speeds.every((d) => d >= 0)).toBe(true);
    expect(Math.max(...speeds)).toBeLessThan(step); // jamais plus d'un pas d'une image à l'autre
    // Au régime établi (hors premier et dernier appui), la vitesse reste presque constante
    const steady = speeds.slice(speeds.length / 5, -speeds.length / 5);
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    // Elle ralentit à chaque appui sans jamais presque s'arrêter, ni filer
    expect(Math.min(...steady)).toBeGreaterThan(mean * 0.4);
    expect(Math.max(...steady)).toBeLessThan(mean * 1.6);
    // La vue rattrape la sélection quand les appuis s'arrêtent
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(target);
  });

  it('cible au-delà du bout de la zone : bornée ; zone qui s\'allonge en route : arrivée à la vraie cible', () => {
    const el = zone(1000, 720);
    animateScrollTo(el, { top: 5000 });
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(280);

    const grows = zone(1000, 720);
    animateScrollTo(grows, { top: 280 });
    run(grows, 100);
    Object.defineProperty(grows, 'scrollHeight', { value: 3000, configurable: true });
    animateScrollTo(grows, { top: 1500 });
    run(grows, SETTLE_MS);
    expect(grows.scrollTop).toBe(1500);
  });

  it('déplacement venu d\'ailleurs en route (ancrage du défilement) : la cible suit le même décalage', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    run(el, 128);
    el.scrollTop += 300; // des rangées se montent au-dessus
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(900);
  });

  it('instantané demandé, ou mouvement réduit : écriture immédiate, aucune image planifiée', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 }, { instant: true });
    expect(el.scrollTop).toBe(600);
    expect(vi.getTimerCount()).toBe(0);

    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    animateScrollTo(el, { top: 100 });
    expect(el.scrollTop).toBe(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settleScroll saute à la cible ; cancelScroll et un geste de l\'utilisateur arrêtent sur place', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    run(el, 64);
    settleScroll(el);
    expect(el.scrollTop).toBe(600);

    animateScrollTo(el, { top: 100 });
    run(el, 64);
    const stopped = el.scrollTop;
    cancelScroll(el);
    run(el, 200);
    expect(el.scrollTop).toBe(stopped);

    animateScrollTo(el, { top: 900 });
    run(el, 64);
    const touched = el.scrollTop;
    document.dispatchEvent(new Event('pointerdown'));
    run(el, 200);
    expect(el.scrollTop).toBe(touched);
  });

  it('animateScrollBy : les pas s\'additionnent sur la cible en cours', () => {
    const el = zone();
    animateScrollBy(el, { top: 100 });
    run(el, 64);
    animateScrollBy(el, { top: 100 });
    run(el, SETTLE_MS);
    expect(el.scrollTop).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Cible : ce que scrollIntoView ferait
// ---------------------------------------------------------------------------

function box(el: HTMLElement, left: number, top: number, width: number, height: number, offset: () => { x: number; y: number } = () => ({ x: 0, y: 0 })) {
  el.getBoundingClientRect = () => {
    const { x, y } = offset();
    return { left: left - x, top: top - y, right: left + width - x, bottom: top + height - y, width, height, x: left - x, y: top - y, toJSON: () => ({}) } as DOMRect;
  };
}

describe('défilement animé léger (TV)', () => {
  /** Images jusqu'à l'arrivée exacte */
  function framesToArrive(el: HTMLElement, target: number): number {
    for (let i = 1; i < 200; i++) {
      vi.advanceTimersByTime(FRAME_MS);
      if (el.scrollTop === target) return i;
    }
    return Infinity;
  }

  it('hors TV : un montage demandé en plein mouvement part tout de suite', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    const mount = vi.fn();
    deferWhileScrolling(mount);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('TV : le montage attend la fin du mouvement, une seule fois, après sa dernière image', () => {
    setTvMode(true);
    const el = zone();
    animateScrollTo(el, { top: 30 });
    const mount = vi.fn();
    deferWhileScrolling(mount);
    expect(mount).not.toHaveBeenCalled();
    let atMount = -1;
    mount.mockImplementation(() => (atMount = el.scrollTop));
    run(el, SETTLE_MS);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(atMount).toBe(30);
  });

  it('TV : un mouvement qui ne finit pas (touche maintenue) ne retient le montage que 350 ms', () => {
    setTvMode(true);
    const el = zone(100000);
    const mount = vi.fn();
    animateScrollTo(el, { top: 400 });
    deferWhileScrolling(mount);
    for (let t = 0, step = 1; t < DEFERRED_MOUNT_MAX_MS + 100; t += 100, step++) {
      vi.advanceTimersByTime(100);
      animateScrollTo(el, { top: 400 + step * 400 });
      if (t + 100 < DEFERRED_MOUNT_MAX_MS) expect(mount).not.toHaveBeenCalled();
    }
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('TV : un montage annulé (sélection repartie) ne part jamais', () => {
    setTvMode(true);
    const el = zone();
    animateScrollTo(el, { top: 600 });
    const mount = vi.fn();
    const cancel = deferWhileScrolling(mount);
    cancel();
    run(el, SETTLE_MS);
    expect(mount).not.toHaveBeenCalled();
  });

  it('TV : sans mouvement en cours, le montage part tout de suite', () => {
    setTvMode(true);
    const mount = vi.fn();
    deferWhileScrolling(mount);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('TV : ressort plus raide, le même appui arrive nettement plus tôt', () => {
    const normal = zone();
    animateScrollTo(normal, { top: 400 });
    const normalFrames = framesToArrive(normal, 400);
    setTvMode(true);
    const light = zone();
    animateScrollTo(light, { top: 400 });
    const lightFrames = framesToArrive(light, 400);
    expect(lightFrames).toBeLessThan(normalFrames * 0.75);
  });
});

describe('cible du défilement', () => {
  function page() {
    const el = zone(3000, 720);
    el.style.overflowY = 'auto';
    box(el, 0, 0, 1280, 720);
    return el;
  }
  const item = (parent: HTMLElement, y: number, h = 100) => {
    const el = document.createElement('button');
    parent.appendChild(el);
    box(el, 0, y, 200, h, () => ({ x: 0, y: parent.scrollTop }));
    return el;
  };

  it('centré : le centre de l\'élément arrive au centre de la zone', () => {
    const p = page();
    const el = item(p, 1000);
    const [target] = computeRevealTargets(el, { block: 'center', inline: 'nearest' });
    expect(target.container).toBe(p);
    expect(target.top).toBe(1050 - 360);
  });

  it('centré : borné au début et à la fin de la zone', () => {
    const p = page();
    expect(computeRevealTargets(item(p, 10), { block: 'center', inline: 'nearest' })[0].top).toBe(0);
    expect(computeRevealTargets(item(p, 2900), { block: 'center', inline: 'nearest' })[0].top).toBe(3000 - 720);
  });

  it('au plus près : rien à faire si l\'élément est entièrement visible, sinon on aligne le bord dépassé', () => {
    const p = page();
    p.scrollTop = 500;
    const visible = item(p, 600);
    expect(computeRevealTargets(visible, { block: 'nearest', inline: 'nearest' })[0].top).toBe(500);
    const below = item(p, 1400);
    expect(computeRevealTargets(below, { block: 'nearest', inline: 'nearest' })[0].top).toBe(1500 - 720);
    const above = item(p, 200);
    expect(computeRevealTargets(above, { block: 'nearest', inline: 'nearest' })[0].top).toBe(200);
  });

  it('scroll-padding de la zone et scroll-margin de l\'élément pris en compte', () => {
    const p = page();
    p.style.scrollPaddingTop = '100px';
    const el = item(p, 1000);
    el.style.scrollMarginTop = '50px';
    p.scrollTop = 1200; // l'élément est au-dessus de la zone
    const [target] = computeRevealTargets(el, { block: 'nearest', inline: 'nearest' });
    expect(target.top).toBe(1000 - 50 - 100);
  });

  it('carrousel dans la page : deux cibles, horizontale pour le carrousel et verticale pour la page', () => {
    const p = page();
    const row = document.createElement('div');
    p.appendChild(row);
    row.style.overflowX = 'auto';
    box(row, 0, 800, 1280, 200, () => ({ x: 0, y: p.scrollTop }));
    let rowScroll = 0;
    Object.defineProperty(row, 'scrollLeft', { get: () => rowScroll, set: (v: number) => (rowScroll = v), configurable: true });
    Object.defineProperty(row, 'scrollWidth', { value: 6000 });
    Object.defineProperty(row, 'clientWidth', { value: 1280 });
    Object.defineProperty(row, 'scrollHeight', { value: 200 });
    Object.defineProperty(row, 'clientHeight', { value: 200 });
    const card = document.createElement('button');
    row.appendChild(card);
    box(card, 3000, 820, 200, 300, () => ({ x: row.scrollLeft, y: p.scrollTop }));
    const targets = computeRevealTargets(card, { block: 'center', inline: 'nearest' });
    expect(targets.map((t) => t.container)).toEqual([row, p]);
    expect(targets[0].left).toBe(3200 - 1280);
    expect(targets[0].top).toBeUndefined();
    expect(targets[1].top).toBe(970 - 360);
  });

  it('page réduite à l\'écran (TV, 0,9) : la dernière carte d\'un carrousel est amenée entière', () => {
    // Banc (géométrie TV, Recherche) : zone visible mesurée en partie à l'écran, en partie en
    // pixels de mise en page ; elle débordait de 10 % à droite et la dernière carte restait rognée.
    const s = 0.9;
    const row = document.createElement('div');
    document.body.appendChild(row);
    row.style.overflowX = 'auto';
    let rowScroll = 0;
    Object.defineProperty(row, 'scrollLeft', { get: () => rowScroll, set: (v: number) => (rowScroll = v), configurable: true });
    Object.defineProperty(row, 'scrollWidth', { value: 1400 });
    Object.defineProperty(row, 'clientWidth', { value: 1280 });
    Object.defineProperty(row, 'offsetWidth', { value: 1280 });
    Object.defineProperty(row, 'scrollHeight', { value: 200 });
    Object.defineProperty(row, 'clientHeight', { value: 200 });
    Object.defineProperty(row, 'offsetHeight', { value: 200 });
    box(row, 64, 100, 1280 * s, 200 * s);
    const card = document.createElement('button');
    row.appendChild(card);
    // Carte de 1200 à 1400 dans le carrousel (pixels de mise en page), vue à l'écran réduite de 0,9
    card.getBoundingClientRect = () => {
      const left = 64 + (1200 - row.scrollLeft) * s;
      return { left, right: left + 200 * s, top: 100, bottom: 100 + 180 * s, width: 200 * s, height: 180 * s, x: left, y: 100, toJSON: () => ({}) } as DOMRect;
    };
    const [target] = computeRevealTargets(card, { block: 'nearest', inline: 'nearest' });
    expect(target.container).toBe(row);
    expect(target.left).toBeCloseTo(1400 - 1280, 6);
  });

  it('fenêtre fixe (confirmation, calque) : la page derrière ne bouge pas, comme avec le natif', () => {
    const p = page();
    const dialog = document.createElement('div');
    dialog.style.position = 'fixed';
    p.appendChild(dialog);
    box(dialog, 400, 300, 480, 200);
    const button = document.createElement('button');
    dialog.appendChild(button);
    box(button, 600, 400, 100, 40);
    p.scrollTop = 500;
    expect(computeRevealTargets(button, { block: 'center', inline: 'nearest' })).toEqual([]);
  });
});
