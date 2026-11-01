/**
 * Pourquoi la vitesse et les pistes d'un film passaient à la Live TV.
 *
 * usePlayerPreferences ne choisissait les pistes qu'une fois la durée connue. Un direct n'a pas de
 * durée (0) : rien n'était remis à zéro côté app, mpv gardait les valeurs du film. La remise à zéro
 * est faite au lancement d'un direct (mpvBridge, voir mpvBridgeConfig.test.ts).
 *
 * Pour la même raison, le menu audio et sous-titres d'un direct restait vide et les
 * langues préférées n'étaient jamais appliquées. Les pistes sont maintenant relues à chaque
 * changement de la liste des pistes (`trackListRevision`, signalé par useMpvObserver).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { setProperty, getProperty } = vi.hoisted(() => ({
  setProperty: vi.fn().mockResolvedValue(undefined),
  getProperty: vi.fn(),
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
vi.mock('../../services/contentPreferencesService', () => ({
  getPlaybackSpeed: vi.fn().mockResolvedValue(null),
  setPlaybackSpeed: vi.fn(),
  getSavedTracks: vi.fn().mockResolvedValue(null),
  saveAudioPreference: vi.fn(),
  saveSubPreference: vi.fn(),
}));

import { usePlayerPreferences, TRACK_LIST_SETTLE_MS } from '../usePlayerPreferences';
import { getSavedTracks } from '../../services/contentPreferencesService';

const tracks = [
  { id: 1, type: 'audio', lang: 'fre', selected: false },
  { id: 2, type: 'audio', lang: 'eng', selected: true },
];

describe('usePlayerPreferences — direct (durée 0)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setProperty.mockClear();
    getProperty.mockClear();
    getProperty.mockImplementation(async (name: string) => (name === 'track-list' ? tracks : null));
  });
  afterEach(() => vi.useRealTimers());

  const touched = () => setProperty.mock.calls.map(([name]) => name).filter((n) => n !== 'sub-scale');

  it('sur un direct pas encore ouvert, ne touche ni à la vitesse ni aux pistes laissées par le film précédent', async () => {
    getProperty.mockImplementation(async (name: string) => (name === 'track-list' ? [] : null));
    renderHook(() => usePlayerPreferences(true, '42', undefined, 0, 0, undefined, async () => {}, () => {}));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(touched()).toEqual([]);
  });

  it('sur un film (durée connue), remet la vitesse à 1 faute de choix mémorisé', async () => {
    renderHook(() => usePlayerPreferences(true, '42', undefined, 5400, 0, undefined, async () => {}, () => {}));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(touched()).toContain('speed');
  });

  it('liste déjà complète avant le branchement de l\'écoute (aucun signal) : relue au montage', async () => {
    renderHook(() => usePlayerPreferences(true, '42', undefined, 0, 0, undefined, async () => {}, () => {}, 0));
    await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);
    expect(setProperty).toHaveBeenCalledWith('aid', 1);
  });

  it('zap pendant la lecture des choix mémorisés : rien n\'est appliqué au chargement suivant', async () => {
    let release: (v: unknown) => void = () => {};
    vi.mocked(getSavedTracks).mockImplementationOnce(() => new Promise((r) => { release = r; }) as never);
    renderHook(() => usePlayerPreferences(true, '42', undefined, 0, 12, undefined, async () => {}, () => {}, 1));
    await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);

    load.sequence++; // zap vers une autre chaîne
    release({ preferredAudio: { lang: 'eng' } });
    await vi.advanceTimersByTimeAsync(0);

    expect(setProperty.mock.calls.filter(([name]) => name === 'aid' || name === 'speed')).toEqual([]);
  });

  describe('liste des pistes du direct', () => {
    it('le menu se remplit et la langue de l\'app est appliquée, sans durée', async () => {
      const { result, rerender } = renderHook(
        ({ revision }) => usePlayerPreferences(true, '42', undefined, 0, 12, undefined, async () => {}, () => {}, revision),
        { initialProps: { revision: 0 } },
      );
      rerender({ revision: 1 });
      await act(async () => { await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS); });

      expect(result.current.audioTracks.map((t) => t.id)).toEqual([1, 2]);
      // Piste 2 (anglais) choisie par mpv ; l'app est en français (langue par défaut) → piste 1
      expect(setProperty).toHaveBeenCalledWith('aid', 1);
    });

    it('le choix mémorisé pour la chaîne est réappliqué', async () => {
      vi.mocked(getSavedTracks).mockResolvedValueOnce({ preferredAudio: { lang: 'eng' } } as never);
      const { rerender } = renderHook(
        ({ revision }) => usePlayerPreferences(true, '42', undefined, 0, 12, undefined, async () => {}, () => {}, revision),
        { initialProps: { revision: 0 } },
      );
      rerender({ revision: 1 });
      await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);

      expect(setProperty).toHaveBeenCalledWith('aid', 2);
    });

    it('les changements répétés de la même liste (flux HLS) n\'appliquent les choix qu\'une fois', async () => {
      const { rerender } = renderHook(
        ({ revision }) => usePlayerPreferences(true, '42', undefined, 0, 12, undefined, async () => {}, () => {}, revision),
        { initialProps: { revision: 0 } },
      );
      for (let revision = 1; revision <= 4; revision++) {
        rerender({ revision });
        await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);
      }

      expect(setProperty.mock.calls.filter(([name]) => name === 'aid')).toHaveLength(1);
    });

    it('zap vers une autre chaîne : ses propres choix sont appliqués', async () => {
      const { rerender } = renderHook(
        ({ revision, id }) => usePlayerPreferences(true, id, undefined, 0, 12, undefined, async () => {}, () => {}, revision),
        { initialProps: { revision: 1, id: '42' } },
      );
      await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);
      setProperty.mockClear();

      rerender({ revision: 1, id: '43' });
      await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);

      expect(setProperty).toHaveBeenCalledWith('aid', 1);
    });

    it('relance du même direct (reconnexion) : les choix sont réappliqués, mpv les a remis par défaut', async () => {
      const { rerender } = renderHook(
        ({ revision }) => usePlayerPreferences(true, '42', undefined, 0, 12, undefined, async () => {}, () => {}, revision),
        { initialProps: { revision: 1 } },
      );
      await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);
      setProperty.mockClear();

      load.sequence++;
      rerender({ revision: 2 });
      await vi.advanceTimersByTimeAsync(TRACK_LIST_SETTLE_MS);

      expect(setProperty).toHaveBeenCalledWith('aid', 1);
    });
  });
});
