/**
 * Sous-titres choisis à la main perdus à l'épisode suivant.
 *
 * Les choix de pistes étaient mémorisés par épisode seulement. L'épisode suivant, sans choix à lui,
 * prenait la langue de l'app : sur une série en VO, les sous-titres français remplaçaient ceux choisis
 * (anglais par exemple) sur l'épisode précédent. Le choix fait sur un épisode vaut désormais pour la
 * série, un choix propre à l'épisode restant prioritaire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { SeriesMetadata, Track } from '../../types/player';

const { setProperty, getProperty, store } = vi.hoisted(() => ({
  setProperty: vi.fn().mockResolvedValue(undefined),
  getProperty: vi.fn(),
  store: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../../services/player/mpvApi', () => ({
  setProperty,
  getProperty,
  command: vi.fn().mockResolvedValue(undefined),
}));
const { load } = vi.hoisted(() => ({ load: { sequence: 1 } }));
vi.mock('../../services/mpvBridge', () => ({ getLoadSequence: () => load.sequence }));
vi.mock('../../services/preferencesService', () => ({
  getSubtitleScale: () => 1,
  setSubtitleScale: vi.fn(),
}));
vi.mock('../../services/playbackProgressService', () => ({
  finalizePlayback: vi.fn().mockResolvedValue(undefined),
  getProgressByStreamId: vi.fn().mockResolvedValue(null),
}));
// Mémoire des choix : même fusion audio / sous-titres que contentPreferencesService
vi.mock('../../services/contentPreferencesService', () => ({
  getPlaybackSpeed: vi.fn().mockResolvedValue(null),
  setPlaybackSpeed: vi.fn(),
  seriesTracksKey: (seriesId: number) => `series-${seriesId}`,
  getSavedTracks: vi.fn(async (key: string) => store.get(key) ?? null),
  saveAudioPreference: vi.fn(async (key: string, pref: unknown) => {
    store.set(key, { ...store.get(key), preferredAudio: pref });
  }),
  saveSubPreference: vi.fn(async (key: string, pref: unknown, disabled: boolean) => {
    store.set(key, { ...store.get(key), preferredSub: pref, subDisabled: disabled });
  }),
}));

import { usePlayerPreferences } from '../usePlayerPreferences';

/** Série en VO anglaise, sous-titres français et anglais (app en français) */
const tracks: Track[] = [
  { id: 1, type: 'audio', lang: 'eng', selected: true },
  { id: 1, type: 'sub', lang: 'fre', title: 'Français' },
  { id: 2, type: 'sub', lang: 'eng', title: 'English' },
];

const episode = (seriesId: number, episodeNumber: number): SeriesMetadata => ({
  seriesId,
  seriesName: 'Série',
  seasonNumber: 1,
  episodeNumber,
  episodeTitle: `Épisode ${episodeNumber}`,
  episodeId: String(100 + episodeNumber),
  containerExtension: 'mkv',
});

// Stables comme dans PlayerControls : une nouvelle fonction à chaque rendu relancerait la lecture des pistes
const syncFromMpv = async () => {};
const setIsSeeking = () => {};

const lastSid = () => setProperty.mock.calls.filter(([name]) => name === 'sid').slice(-1)[0]?.[1];

describe('usePlayerPreferences — choix de pistes d\'une série', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store.clear();
    setProperty.mockClear();
    getProperty.mockImplementation(async (name: string) => (name === 'track-list' ? tracks : null));
  });
  afterEach(() => vi.useRealTimers());

  const mount = (contentId: string, series: SeriesMetadata | undefined) => renderHook(
    (props: { contentId: string; series: SeriesMetadata | undefined }) => usePlayerPreferences(
      true, props.contentId, undefined, 1500, 0, props.series, syncFromMpv, setIsSeeking,
    ),
    { initialProps: { contentId, series } },
  );
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(1000); });

  it('les sous-titres choisis à la main suivent à l\'épisode suivant', async () => {
    const view = mount('101', episode(5, 1));
    await settle();
    expect(lastSid()).toBe(1); // aucun choix : sous-titres dans la langue de l'app

    await act(async () => { await view.result.current.selectSubTrack(2); });

    load.sequence++;
    view.rerender({ contentId: '102', series: episode(5, 2) });
    await settle();
    expect(lastSid()).toBe(2);
  });

  it('sous-titres coupés à la main : restent coupés à l\'épisode suivant', async () => {
    const view = mount('101', episode(5, 1));
    await settle();
    await act(async () => { await view.result.current.selectSubTrack(0); });

    load.sequence++;
    view.rerender({ contentId: '102', series: episode(5, 2) });
    await settle();
    expect(lastSid()).toBe(0);
  });

  it('série connue après le début de la lecture (Continuer à regarder) : son choix est appliqué', async () => {
    store.set('series-5', { preferredSub: { lang: 'eng', title: 'English' }, subDisabled: false });
    const view = mount('102', undefined);
    await settle();
    expect(lastSid()).toBe(1);

    view.rerender({ contentId: '102', series: episode(5, 2) });
    await settle();
    expect(lastSid()).toBe(2);
  });

  it('épisode où seul l\'audio a été choisi : sous-titres de la série', async () => {
    store.set('102', { preferredAudio: { lang: 'eng' } });
    store.set('series-5', { preferredSub: { lang: 'eng', title: 'English' }, subDisabled: false });
    mount('102', episode(5, 2));
    await settle();
    expect(lastSid()).toBe(2);
  });

  it('un choix propre à l\'épisode reste prioritaire sur celui de la série', async () => {
    store.set('101', { preferredSub: { lang: 'fre', title: 'Français' }, subDisabled: false });
    store.set('series-5', { preferredSub: { lang: 'eng', title: 'English' }, subDisabled: false });
    mount('101', episode(5, 1));
    await settle();
    expect(lastSid()).toBe(1);
  });

  it('le choix d\'une série ne s\'applique ni à une autre série ni à un film', async () => {
    store.set('series-5', { preferredSub: { lang: 'eng', title: 'English' }, subDisabled: false });

    mount('201', episode(6, 1));
    await settle();
    expect(lastSid()).toBe(1);

    setProperty.mockClear();
    load.sequence++;
    mount('301', undefined);
    await settle();
    expect(lastSid()).toBe(1);
  });
});
