/**
 * Taille des photos de fond TMDB (audit performance, fiche F2) : originale sur PC (qualité inchangée),
 * 1280 px sur TV et téléphone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const platform = { tv: false, mobile: false };
vi.mock('../platform', () => ({
  isTv: () => platform.tv,
  isMobile: () => platform.mobile,
}));

import { backdropImageSize } from '../tmdbImageSize';

describe('backdropImageSize', () => {
  beforeEach(() => {
    platform.tv = false;
    platform.mobile = false;
  });

  it('PC : taille originale, qualité inchangée', () => {
    expect(backdropImageSize()).toBe('original');
  });

  it('Android TV : 1280 px (toile de 1280 × 720)', () => {
    platform.tv = true;
    expect(backdropImageSize()).toBe('w1280');
  });

  it('téléphone : 1280 px', () => {
    platform.mobile = true;
    expect(backdropImageSize()).toBe('w1280');
  });
});
