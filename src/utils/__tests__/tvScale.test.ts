/**
 * Tests pour tvScale.ts — toile TV fixe mise à l'échelle de l'écran
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyTvViewport, zoomForWindow, TV_CANVAS } from '../tvScale';

describe('tvScale', () => {
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />';
  });

  it('Chromecast (960 × 540) : page en 1280 px de large, affichée à 0,75', () => {
    Object.defineProperty(window.screen, 'width', { value: 960, configurable: true });
    Object.defineProperty(window.screen, 'height', { value: 540, configurable: true });
    applyTvViewport();
    const content = document.querySelector('meta[name="viewport"]')?.getAttribute('content');
    expect(content).toBe(
      `width=${TV_CANVAS.width}, initial-scale=0.7500, minimum-scale=0.7500, maximum-scale=0.7500, user-scalable=no`,
    );
  });

  it('fenêtre Windows 2560 × 1369 : la toile tient entière, sans rognage vertical', () => {
    const zoom = zoomForWindow(2560, 1369);
    expect(TV_CANVAS.height * zoom).toBeLessThanOrEqual(1369);
    expect(TV_CANVAS.width * zoom).toBeLessThanOrEqual(2560);
    expect(zoom).toBeCloseTo(1369 / 720, 5);
  });

  it('box 720p : échelle 1', () => {
    expect(zoomForWindow(1280, 720)).toBe(1);
  });
});
