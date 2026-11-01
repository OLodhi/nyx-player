import { describe, it, expect } from 'vitest';
import { guideWindow, inTimeWindow, sameWindow, ROW_STEP, TIME_STEP_MIN, type GuideView } from '../guideWindow';

const ORIGIN = 1_790_000_000 - (1_790_000_000 % 86400);
const H = 3600;
/** Toile TV : 64 px par rangée, 4 px par minute */
const view = (scrollTop: number, scrollLeft: number): GuideView => ({
  scrollTop, scrollLeft, width: 1100, height: 560, rowPx: 64, pxPerMinute: 4,
});

describe('guideWindow', () => {
  it("couvre l'écran avec une marge, et pas toute la grille", () => {
    const w = guideWindow(view(0, 20 * 60 * 4), 120, ORIGIN);
    expect(w.firstRow).toBe(0);
    // ≈ 9 rangées à l'écran + une demi-hauteur de marge
    expect(w.lastRow).toBeGreaterThanOrEqual(Math.ceil(560 / 64));
    expect(w.lastRow).toBeLessThan(20);
    expect(w.fromTs).toBeLessThanOrEqual(ORIGIN + 20 * H - 60 * 60);
    expect(w.toTs).toBeGreaterThanOrEqual(ORIGIN + 20 * H + (1100 / 4) * 60);
    expect(w.toTs - w.fromTs).toBeLessThan(10 * H);
  });

  it('avance par pas : un petit défilement ne change pas la fenêtre', () => {
    const a = guideWindow(view(30 * 64, 10 * 60 * 4), 120, ORIGIN);
    const b = guideWindow(view(30 * 64 + 10, 10 * 60 * 4 + 20), 120, ORIGIN);
    expect(sameWindow(a, b)).toBe(true);
    expect(a.firstRow % ROW_STEP).toBe(0);
    expect(((a.fromTs - ORIGIN) / 60) % TIME_STEP_MIN).toBe(0);
  });

  it('défiler de 25 rangées change la fenêtre peu souvent (un rendu par pas, en pleine animation)', () => {
    let changes = 0;
    let prev = guideWindow(view(0, 0), 120, ORIGIN);
    for (let px = 8; px <= 25 * 64; px += 8) {
      const next = guideWindow(view(px, 0), 120, ORIGIN);
      if (!sameWindow(prev, next)) changes += 1;
      prev = next;
    }
    // Avec un pas de 2 : environ 23 changements ; avec 6 : environ 7 (haut et bas avancent chacun) ; sur Chromecast, 15 % d'images en retard contre 8 % avant
    expect(changes).toBeLessThanOrEqual(9);
  });

  it('garde les cases épinglées, même loin de l\'écran', () => {
    const w = guideWindow(view(0, 20 * 60 * 4), 120, ORIGIN, [{ row: 80, startTs: ORIGIN + 2 * H }, { row: 3, startTs: null }]);
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(80);
    expect(w.fromTs).toBeLessThanOrEqual(ORIGIN + 2 * H);
  });

  it('bornée aux chaînes existantes', () => {
    expect(guideWindow(view(0, 0), 3, ORIGIN)).toMatchObject({ firstRow: 0, lastRow: 2 });
    expect(guideWindow(view(500 * 64, 0), 10, ORIGIN)).toMatchObject({ lastRow: 9 });
    expect(guideWindow(view(0, 0), 0, ORIGIN)).toMatchObject({ firstRow: 0, lastRow: -1 });
  });

  it('sans taille connue : toutes les heures', () => {
    const w = guideWindow(view(0, 0), 10, ORIGIN, [], true);
    expect(w.fromTs).toBe(-Infinity);
    expect(w.toTs).toBe(Infinity);
  });

  it('un programme long commencé avant la fenêtre y reste (à cheval sur minuit aussi)', () => {
    const w = { fromTs: ORIGIN, toTs: ORIGIN + 4 * H };
    expect(inTimeWindow(ORIGIN - H, ORIGIN + H, w)).toBe(true);
    expect(inTimeWindow(ORIGIN - 2 * H, ORIGIN, w)).toBe(false);
    expect(inTimeWindow(ORIGIN + 4 * H, ORIGIN + 5 * H, w)).toBe(false);
  });
});
