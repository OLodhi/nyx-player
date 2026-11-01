/**
 * Tests unitaires pour seriesMetadataBuilder.ts
 *
 * Fonction pure — aucun mock SQLite nécessaire.
 */

import { describe, it, expect } from 'vitest';
import { buildSeriesMetadata } from '../seriesMetadataBuilder';
import type { AppSeriesInfo, XtreamEpisode } from '../../types/xtream';

// ─── Helpers: Fixtures ──────────────────────────────────────────────

/** Crée un épisode minimal */
function makeEpisode(overrides: Partial<XtreamEpisode> = {}): XtreamEpisode {
  return {
    id: '100',
    episode_num: 1,
    title: 'Pilot',
    container_extension: 'mp4',
    ...overrides,
  };
}

/** Crée une AppSeriesInfo minimale */
function makeSeries(overrides: Partial<AppSeriesInfo> = {}): AppSeriesInfo {
  return {
    num: 1,
    name: 'Test Series',
    series_id: 42,
    cover: 'https://example.com/cover.jpg',
    plot: '',
    cast: '',
    director: '',
    genre: '',
    releaseDate: '',
    last_modified: '',
    rating: '',
    category_id: '1',
    tmdb: 12345,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('buildSeriesMetadata', () => {
  // ── Test 1: Metadata basique ──
  it('retourne les champs attendus (seriesId, seasonNumber, etc.)', () => {
    const episode = makeEpisode({ id: '200', episode_num: 3, title: 'Episode 3' });
    const series = makeSeries({
      episodes: {
        1: [
          makeEpisode({ id: '198', episode_num: 1 }),
          makeEpisode({ id: '199', episode_num: 2 }),
          episode,
        ],
      },
    });

    const result = buildSeriesMetadata(series, episode);

    expect(result.seriesId).toBe(42);
    expect(result.seriesName).toBe('Test Series');
    expect(result.seasonNumber).toBe(1);
    expect(result.episodeNumber).toBe(3);
    expect(result.episodeTitle).toBe('Episode 3');
    expect(result.episodeId).toBe('200');
    expect(result.containerExtension).toBe('mp4');
    expect(result.tmdbId).toBe(12345);
    expect(result.seriesCover).toBe('https://example.com/cover.jpg');
  });

  // ── Test 2: Épisode suivant existe ──
  it('retourne nextEpisode non-null quand un épisode suivant existe', () => {
    const ep1 = makeEpisode({ id: '10', episode_num: 1 });
    const ep2 = makeEpisode({ id: '11', episode_num: 2, container_extension: 'mkv' });
    const series = makeSeries({ episodes: { 1: [ep1, ep2] } });

    const result = buildSeriesMetadata(series, ep1);

    expect(result.nextEpisode).not.toBeNull();
    expect(result.nextEpisode).toEqual({
      episodeId: '11',
      seasonNumber: 1,
      episodeNumber: 2,
      episodeTitle: 'Pilot',
      episodeCover: undefined,
      containerExtension: 'mkv',
    });
  });

  // ── Test 3: Dernier épisode ──
  it('retourne nextEpisode = null pour le dernier épisode de la série', () => {
    const ep1 = makeEpisode({ id: '10', episode_num: 1 });
    const ep2 = makeEpisode({ id: '11', episode_num: 2 });
    const series = makeSeries({ episodes: { 1: [ep1, ep2] } });

    const result = buildSeriesMetadata(series, ep2);

    expect(result.nextEpisode).toBeNull();
  });

  // ── Test 4: Transition de saison ──
  it("retourne l'épisode suivant dans la saison N+1 lors d'une transition", () => {
    const s1e2 = makeEpisode({ id: '12', episode_num: 2 }); // Dernier épisode S1
    const s2e1 = makeEpisode({ id: '20', episode_num: 1, container_extension: 'ts' }); // Premier S2
    const series = makeSeries({
      episodes: {
        1: [makeEpisode({ id: '11', episode_num: 1 }), s1e2],
        2: [s2e1, makeEpisode({ id: '21', episode_num: 2 })],
      },
    });

    const result = buildSeriesMetadata(series, s1e2);

    expect(result.nextEpisode).toEqual({
      episodeId: '20',
      seasonNumber: 2,
      episodeNumber: 1,
      episodeTitle: 'Pilot',
      episodeCover: undefined,
      containerExtension: 'ts',
    });
  });

  // ── Test 5: tmdbTitle optionnel ──
  it('seriesNameTmdb = undefined quand tmdbTitle est absent', () => {
    const episode = makeEpisode();
    const series = makeSeries({ episodes: { 1: [episode] } });

    const result = buildSeriesMetadata(series, episode);

    expect(result.seriesNameTmdb).toBeUndefined();
  });

  it('seriesNameTmdb est défini quand tmdbTitle est fourni', () => {
    const episode = makeEpisode();
    const series = makeSeries({ episodes: { 1: [episode] } });

    const result = buildSeriesMetadata(series, episode, 'Breaking Bad');

    expect(result.seriesNameTmdb).toBe('Breaking Bad');
  });

  // ── Test 6: tmdb invalide (zéro) → tmdbId = undefined ──
  it('tmdbId = undefined quand tmdb est invalide (normalizeTmdbId(0) → 0, puis 0 || undefined)', () => {
    const episode = makeEpisode();
    const series = makeSeries({
      tmdb: 0, // normalizeTmdbId(0) → 0, puis `0 || undefined` → undefined
      episodes: { 1: [episode] },
    });

    const result = buildSeriesMetadata(series, episode);

    expect(result.tmdbId).toBeUndefined();
  });

  // ── Test 7: episodes absents → seasonNumber = 1, nextEpisode = null ──
  it('seasonNumber = 1 et nextEpisode = null quand series.episodes est undefined', () => {
    const episode = makeEpisode();
    const series = makeSeries(); // pas de episodes

    const result = buildSeriesMetadata(series, episode);

    expect(result.seasonNumber).toBe(1);
    expect(result.nextEpisode).toBeNull();
  });

  // ── Test 8: container_extension absent → fallback 'ts' (harmonisé avec buildStreamUrl) ──
  it("containerExtension = 'ts' quand container_extension est absent (undefined)", () => {
    // Force container_extension à undefined via cast pour simuler l'absence du champ
    const episode = makeEpisode({ container_extension: undefined as unknown as string });
    const series = makeSeries({ episodes: { 1: [episode] } });

    const result = buildSeriesMetadata(series, episode);

    expect(result.containerExtension).toBe('ts');
  });

  it("containerExtension = 'ts' quand container_extension est une string vide", () => {
    const episode = makeEpisode({ container_extension: '' });
    const series = makeSeries({ episodes: { 1: [episode] } });

    const result = buildSeriesMetadata(series, episode);

    expect(result.containerExtension).toBe('ts');
  });
});
