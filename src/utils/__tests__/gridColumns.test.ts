/**
 * Tests pour gridColumns.ts — cartes encadrées entre ≈ 92 et 150 points sur téléphone
 */

import { describe, it, expect } from 'vitest';
import {
  fitGridColumns,
  COMPACT_CARD_BOUNDS,
  channelGridRightPadding,
  categoryGridPaddingLeft,
  categoryGridPaddingRight,
  categoryGridColumnBounds,
} from '../gridColumns';

/** Grille de chaînes du téléphone : marges de 16 points de chaque côté, 12 points entre cartes, 5 colonnes au plus. */
const PHONE_GAP = 12;
const phoneChannelColumns = (screenWidth: number) =>
  fitGridColumns(screenWidth - 32, PHONE_GAP, {
    minCard: COMPACT_CARD_BOUNDS.min,
    maxCard: COMPACT_CARD_BOUNDS.max,
    maxColumns: 5,
  });
const phoneChannelCard = (screenWidth: number) =>
  Math.floor((screenWidth - 32) / phoneChannelColumns(screenWidth)) - PHONE_GAP;

describe('fitGridColumns', () => {
  it('téléphone de 360 points : 3 colonnes de chaînes, plus 2 cartes géantes', () => {
    expect(phoneChannelColumns(360)).toBe(3);
  });

  it.each([
    [320, 2],
    [360, 3],
    [411, 3],
    [480, 4],
    [768, 5],
  ])('écran de %i points : %i colonnes (exemples mesurés)', (width, columns) => {
    expect(phoneChannelColumns(width)).toBe(columns);
  });

  it('les cartes restent entre 92 et 150 points sur les largeurs de téléphone et tablette en portrait', () => {
    for (let width = 260; width <= 900; width += 1) {
      const card = phoneChannelCard(width);
      expect(card, `écran de ${width} points`).toBeGreaterThanOrEqual(COMPACT_CARD_BOUNDS.min);
      expect(card, `écran de ${width} points`).toBeLessThanOrEqual(COMPACT_CARD_BOUNDS.max);
    }
  });

  it('dépasse le plafond de colonnes quand il laisserait des cartes trop larges', () => {
    // 868 points utiles, plafond de 5 colonnes : cartes de 161 points, au-delà de 150.
    expect(fitGridColumns(868, PHONE_GAP, { minCard: 92, maxCard: 150, maxColumns: 5 })).toBe(6);
  });

  it('sans largeur maximale, garde le comportement historique (bureau et TV)', () => {
    // Chaînes du bureau : minimum 220, 5 colonnes au plus.
    expect(fitGridColumns(1100, 24, { minCard: 220, maxColumns: 5 })).toBe(4);
    expect(fitGridColumns(2000, 24, { minCard: 220, maxColumns: 5 })).toBe(5);
    // « Voir tout » du bureau : minimum 250, pas d'espace après la dernière carte.
    expect(fitGridColumns(1000 + 24, 24, { minCard: 250 })).toBe(3);
  });

  it('jamais moins d’une colonne, même avant la mesure du conteneur', () => {
    expect(fitGridColumns(0, 12, { minCard: 92, maxCard: 150 })).toBe(1);
    expect(fitGridColumns(-40, 12, { minCard: 92 })).toBe(1);
    expect(fitGridColumns(50, 12, { minCard: 92, maxCard: 150, maxColumns: 5 })).toBe(1);
  });
});

describe('channelGridRightPadding (cadre de focus du panneau de zapping)', () => {
  it('laisse de la place au cadre de focus sur TV pour 2 colonnes', () => {
    expect(channelGridRightPadding({ maxColumns: 2, phone: false, tv: true, defaultPadding: 32 })).toBe(20);
  });
  it('garde 8 px hors TV et la valeur par défaut pour la grille pleine page', () => {
    expect(channelGridRightPadding({ maxColumns: 2, phone: false, tv: false, defaultPadding: 32 })).toBe(8);
    expect(channelGridRightPadding({ phone: false, tv: true, defaultPadding: 32 })).toBe(32);
    expect(channelGridRightPadding({ phone: true, tv: false, defaultPadding: 32 })).toBe(0);
  });
});

describe('categoryGridPaddingLeft (pages « Voir tout »)', () => {
  it('sur TV, prend la zone de barre latérale mesurée quand elle dépasse 136', () => {
    expect(categoryGridPaddingLeft({ compact: false, tv: true, measuredSafeZone: 175.6 })).toBe(176);
  });
  it('garde 136 sur bureau et 16 sur téléphone', () => {
    expect(categoryGridPaddingLeft({ compact: false, tv: false, measuredSafeZone: 200 })).toBe(136);
    expect(categoryGridPaddingLeft({ compact: true, tv: false, measuredSafeZone: 0 })).toBe(16);
  });
  it('sur TV, ne descend jamais sous 136 si la mesure échoue', () => {
    expect(categoryGridPaddingLeft({ compact: false, tv: true, measuredSafeZone: 0 })).toBe(136);
  });
});

describe('categoryGridColumnBounds (pages « Voir tout »)', () => {
  const GAP = 24;
  // Toile TV de 1280 px : barre latérale (≈ 191 px) à gauche, zone sûre (64 px) à droite
  const TV_TRACK = 1280 - 191 - 64 + GAP;

  it('sur TV, 5 affiches par ligne au lieu de 3 affiches presque aussi hautes que l\'écran', () => {
    expect(fitGridColumns(TV_TRACK, GAP, categoryGridColumnBounds({ compact: false, tv: true }))).toBe(5);
  });
  it('sur TV, jamais plus de 5 colonnes, même sur une toile plus large', () => {
    expect(fitGridColumns(1920 - 191 - 96 + GAP, GAP, categoryGridColumnBounds({ compact: false, tv: true }))).toBe(5);
  });
  it('bureau et téléphone gardent leurs règles', () => {
    expect(categoryGridColumnBounds({ compact: false, tv: false })).toEqual({ minCard: 250 });
    expect(fitGridColumns(1000 + GAP, GAP, categoryGridColumnBounds({ compact: false, tv: false }))).toBe(3);
    expect(categoryGridColumnBounds({ compact: true, tv: false })).toEqual({ minCard: COMPACT_CARD_BOUNDS.min, maxCard: COMPACT_CARD_BOUNDS.max });
  });
});

describe('categoryGridPaddingRight (pages « Voir tout »)', () => {
  it('sur TV, la dernière colonne s\'arrête à la zone sûre mesurée, jamais moins de 48', () => {
    expect(categoryGridPaddingRight({ compact: false, tv: true, measuredSafeX: 64 })).toBe(64);
    expect(categoryGridPaddingRight({ compact: false, tv: true, measuredSafeX: 0 })).toBe(48);
  });
  it('garde 48 sur bureau et 16 sur téléphone', () => {
    expect(categoryGridPaddingRight({ compact: false, tv: false, measuredSafeX: 64 })).toBe(48);
    expect(categoryGridPaddingRight({ compact: true, tv: false, measuredSafeX: 0 })).toBe(16);
  });
});
