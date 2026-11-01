/**
 * Défilement vertical joué par le compositeur : la zone saute à la cible, ses enfants rejouent la même courbe en
 * décalage. Le navigateur de test n'anime rien : `animate` est remplacé par un relevé des images clés, et l'instant
 * montré à l'écran suit l'horloge simulée.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  animateScrollTo,
  cancelAllScrolls,
  computeRevealTargets,
  playVerticalOnCompositor,
  settleScroll,
  visualScrollTop,
} from '../spatialNavigation/scrollAnimator';

const FRAME_MS = 16;

interface FakeAnimation {
  frames: Keyframe[];
  duration: number;
  start: number;
  cancelled: boolean;
}

let animations: FakeAnimation[] = [];

/** Zone qui défile, avec deux enfants que l'on peut « animer » */
function zone(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let position = 0;
  Object.defineProperty(el, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 5000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 720 });
  for (let i = 0; i < 2; i += 1) {
    const child = document.createElement('div');
    child.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const record: FakeAnimation = { frames, duration: Number(options.duration), start: performance.now(), cancelled: false };
      animations.push(record);
      return {
        get currentTime() { return record.cancelled ? null : performance.now() - record.start; },
        cancel() { record.cancelled = true; },
      } as unknown as Animation;
    }) as typeof child.animate;
    el.appendChild(child);
  }
  el.animate = (() => ({}) as Animation) as typeof el.animate;
  return el;
}

const offsetOf = (frame: Keyframe) => Number(/^0 (-?[\d.]+)px$/.exec(String(frame.translate))?.[1]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.stubGlobal('CSS', { supports: (property: string) => property === 'translate' });
  animations = [];
  document.body.innerHTML = '';
});

afterEach(() => {
  cancelAllScrolls();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('défilement joué par le compositeur', () => {
  it('la zone est tout de suite à la cible, ses enfants partent du décalage inverse et reviennent à 0', () => {
    const el = zone();
    const release = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 600 });
    expect(el.scrollTop).toBe(600);
    expect(animations).toHaveLength(2);
    const { frames } = animations[0];
    expect(offsetOf(frames[0])).toBe(600);
    expect(offsetOf(frames[frames.length - 1])).toBe(0);
    // Toujours en avançant, sans rebond : le décalage ne fait que baisser
    expect(frames.every((frame, i) => i === 0 || offsetOf(frame) <= offsetOf(frames[i - 1]))).toBe(true);
    release();
  });

  it('pendant le mouvement : la position vue à l\'écran suit la courbe, et rien n\'est écrit ni relu à chaque image', () => {
    const el = zone();
    const release = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 600 });
    const writes = vi.fn();
    let position = el.scrollTop;
    Object.defineProperty(el, 'scrollTop', { get: () => position, set: (v: number) => { writes(v); position = v; }, configurable: true });
    const heights = vi.fn(() => 5000);
    Object.defineProperty(el, 'scrollHeight', { get: heights, configurable: true });
    vi.advanceTimersByTime(5 * FRAME_MS);
    const seen = visualScrollTop(el);
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(600);
    vi.advanceTimersByTime(1500);
    expect(visualScrollTop(el)).toBe(600);
    expect(writes).not.toHaveBeenCalled();
    expect(heights).not.toHaveBeenCalled();
    release();
  });

  it('nouvel appui en route : la courbe repart de la position vue à l\'écran, sans saut', () => {
    const el = zone();
    const release = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 400 });
    vi.advanceTimersByTime(6 * FRAME_MS);
    const seen = visualScrollTop(el);
    animateScrollTo(el, { top: 800 });
    expect(el.scrollTop).toBe(800);
    expect(animations[0].cancelled).toBe(true);
    const restart = animations[animations.length - 1].frames;
    expect(offsetOf(restart[0])).toBeCloseTo(800 - seen, 0);
    release();
  });

  it('cible calculée d\'après la position vue à l\'écran, pas d\'après `scrollTop` déjà à la cible', () => {
    const el = zone();
    el.style.overflowY = 'auto';
    el.getBoundingClientRect = () => ({ top: 0, bottom: 720, left: 0, right: 1280, width: 1280, height: 720, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(el, 'offsetHeight', { value: 720 });
    Object.defineProperty(el, 'offsetWidth', { value: 1280 });
    Object.defineProperty(el, 'clientWidth', { value: 1280 });
    Object.defineProperty(el, 'scrollWidth', { value: 1280 });
    const release = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 600 });
    vi.advanceTimersByTime(5 * FRAME_MS);
    const seen = visualScrollTop(el);
    // Élément affiché 300 px sous le haut de l'écran, avec la page là où on la voit
    const target = el.firstElementChild as HTMLElement;
    target.getBoundingClientRect = () => ({ top: 300, bottom: 400, left: 0, right: 100, width: 100, height: 100, x: 0, y: 300, toJSON: () => ({}) }) as DOMRect;
    const [reveal] = computeRevealTargets(target, { block: 'center', inline: 'nearest' });
    expect(reveal.top).toBeCloseTo(seen + (350 - 360), 0);
    release();
  });

  it('arrêt demandé en route : la zone reprend la position vue à l\'écran ; `settleScroll` va à la cible', () => {
    const el = zone();
    const release = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 600 });
    vi.advanceTimersByTime(5 * FRAME_MS);
    const seen = visualScrollTop(el);
    release();
    expect(el.scrollTop).toBe(Math.round(seen));
    expect(animations.every((animation) => animation.cancelled)).toBe(true);

    const again = playVerticalOnCompositor(el);
    animateScrollTo(el, { top: 1200 });
    vi.advanceTimersByTime(5 * FRAME_MS);
    settleScroll(el);
    expect(el.scrollTop).toBe(1200);
    again();
  });

  it('zone qui ne l\'a pas demandé, ou WebView sans `translate` animable : défilement écrit par le script', () => {
    const el = zone();
    animateScrollTo(el, { top: 600 });
    expect(el.scrollTop).toBe(0);
    vi.advanceTimersByTime(FRAME_MS);
    expect(el.scrollTop).toBeGreaterThan(0);
    expect(animations).toHaveLength(0);
    cancelAllScrolls();

    vi.stubGlobal('CSS', { supports: () => false });
    const old = zone();
    const release = playVerticalOnCompositor(old);
    animateScrollTo(old, { top: 600 });
    expect(old.scrollTop).toBe(0);
    expect(animations).toHaveLength(0);
    release();
  });

  it('deux demandes sur la même zone : le compositeur reste tant que l\'une tient', () => {
    const el = zone();
    const first = playVerticalOnCompositor(el);
    const second = playVerticalOnCompositor(el);
    first();
    first();
    animateScrollTo(el, { top: 600 });
    expect(el.scrollTop).toBe(600);
    second();
    animateScrollTo(el, { top: 900 });
    expect(el.scrollTop).toBeLessThan(900);
  });
});
