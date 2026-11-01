/**
 * Tests pour useSeriesSourceSelection.ts
 * Vérifie : choix initial par langue, mémorisation, changement de source, resynchro au retour du lecteur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AppSeriesInfo } from '../../types/xtream';
import type { IptvSeries } from '../../types/iptv';

vi.mock('../../services/contentPreferencesService', () => ({
  getPreferredSource: vi.fn(),
  setPreferredSource: vi.fn(),
}));

vi.mock('../../i18n/config', () => ({
  default: { language: 'fr', resolvedLanguage: 'fr' },
}));

let mockCurrentlyPlaying: unknown = null;
vi.mock('../../contexts/PlayerContext', () => ({
  usePlayer: () => ({ currentlyPlaying: mockCurrentlyPlaying }),
}));

import { useSeriesSourceSelection } from '../useSeriesSourceSelection';
import { getPreferredSource, setPreferredSource } from '../../services/contentPreferencesService';

function make(id: number, name: string, tmdb = 42): IptvSeries {
  return { series_id: String(id), name, tmdb } as unknown as IptvSeries;
}

function withVersions(...versions: IptvSeries[]): AppSeriesInfo {
  return { ...versions[0], groupedVersions: versions } as unknown as AppSeriesInfo;
}

describe('useSeriesSourceSelection', () => {
  const en = make(1, 'Serie EN');
  const fr = make(2, 'Serie FR');

  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentlyPlaying = null;
    vi.mocked(getPreferredSource).mockResolvedValue(null);
    vi.mocked(setPreferredSource).mockResolvedValue(undefined);
  });

  describe('Choix initial', () => {
    it('garde la série quand il n\'y a qu\'une source', () => {
      const initial = make(1, 'Seule') as unknown as AppSeriesInfo;
      const { result } = renderHook(() => useSeriesSourceSelection({ initialSeries: initial }));
      expect(result.current.selectedSource).toBe(initial);
      expect(result.current.groupedVersions).toEqual([initial]);
      expect(setPreferredSource).not.toHaveBeenCalled();
    });

    it('choisit la source dans la langue de l\'application', async () => {
      const { result } = renderHook(() => useSeriesSourceSelection({ initialSeries: withVersions(en, fr) }));
      expect(result.current.selectedSource.series_id).toBe('2');
      await waitFor(() => expect(setPreferredSource).toHaveBeenCalledWith('series', 42, 2));
    });

    it('ne remplace pas une préférence déjà enregistrée', async () => {
      vi.mocked(getPreferredSource).mockResolvedValue(1);
      renderHook(() => useSeriesSourceSelection({ initialSeries: withVersions(en, fr) }));
      await waitFor(() => expect(getPreferredSource).toHaveBeenCalled());
      expect(setPreferredSource).not.toHaveBeenCalled();
    });

    it('n\'enregistre rien quand la série n\'a pas d\'identifiant TMDB', () => {
      const a = make(1, 'A EN', 0);
      const b = make(2, 'B FR', 0);
      renderHook(() => useSeriesSourceSelection({ initialSeries: withVersions(a, b) }));
      expect(getPreferredSource).not.toHaveBeenCalled();
    });
  });

  describe('Changement de source', () => {
    it('sans chargement différé, passe à la version trouvée et l\'enregistre', async () => {
      const { result } = renderHook(() => useSeriesSourceSelection({ initialSeries: withVersions(en, fr) }));
      await act(async () => {
        await result.current.handleSourceChange({ id: 1, name: 'Serie EN' });
      });
      expect(result.current.selectedSource.series_id).toBe('1');
      expect(setPreferredSource).toHaveBeenCalledWith('series', 42, 1);
      expect(result.current.hasUserChangedSource.current).toBe(true);
    });

    it('charge la version choisie quand un chargement est fourni', async () => {
      const loaded = make(1, 'Serie EN complète');
      const onLoadVersion = vi.fn().mockResolvedValue(loaded);
      const { result } = renderHook(() =>
        useSeriesSourceSelection({ initialSeries: withVersions(en, fr), onLoadVersion }),
      );
      await act(async () => {
        await result.current.handleSourceChange({ id: 1, name: 'Serie EN' });
      });
      expect(onLoadVersion).toHaveBeenCalledWith(1);
      expect(result.current.selectedSource).toBe(loaded);
    });

    it('garde la source actuelle quand le chargement ne renvoie rien', async () => {
      const onLoadVersion = vi.fn().mockResolvedValue(null);
      const { result } = renderHook(() =>
        useSeriesSourceSelection({ initialSeries: withVersions(en, fr), onLoadVersion }),
      );
      await act(async () => {
        await result.current.handleSourceChange({ id: 1, name: 'Serie EN' });
      });
      expect(result.current.selectedSource.series_id).toBe('2');
    });

    it('ne fait rien quand on choisit la source déjà affichée', async () => {
      const { result } = renderHook(() => useSeriesSourceSelection({ initialSeries: withVersions(en, fr) }));
      await waitFor(() => expect(setPreferredSource).toHaveBeenCalledTimes(1));
      vi.mocked(setPreferredSource).mockClear();
      await act(async () => {
        await result.current.handleSourceChange({ id: 2, name: 'Serie FR' });
      });
      expect(setPreferredSource).not.toHaveBeenCalled();
      expect(result.current.hasUserChangedSource.current).toBe(false);
    });
  });

  describe('Retour du lecteur', () => {
    it('recharge la source mémorisée quand le lecteur se ferme', async () => {
      mockCurrentlyPlaying = { id: 'ep1' };
      const loaded = make(1, 'Serie EN complète');
      const onLoadVersion = vi.fn().mockResolvedValue(loaded);
      const { result, rerender } = renderHook(() =>
        useSeriesSourceSelection({ initialSeries: withVersions(en, fr), onLoadVersion }),
      );
      vi.mocked(getPreferredSource).mockResolvedValue(1);
      mockCurrentlyPlaying = null;
      rerender();
      await waitFor(() => expect(result.current.selectedSource).toBe(loaded));
      expect(onLoadVersion).toHaveBeenCalledWith(1);
    });

    it('ne recharge rien quand la source mémorisée est déjà affichée', async () => {
      mockCurrentlyPlaying = { id: 'ep1' };
      const onLoadVersion = vi.fn();
      const { rerender } = renderHook(() =>
        useSeriesSourceSelection({ initialSeries: withVersions(en, fr), onLoadVersion }),
      );
      vi.mocked(getPreferredSource).mockResolvedValue(2);
      mockCurrentlyPlaying = null;
      rerender();
      await waitFor(() => expect(getPreferredSource).toHaveBeenCalled());
      expect(onLoadVersion).not.toHaveBeenCalled();
    });

    it('ne recharge rien quand aucune préférence n\'est mémorisée', async () => {
      mockCurrentlyPlaying = { id: 'ep1' };
      const onLoadVersion = vi.fn();
      const { rerender } = renderHook(() =>
        useSeriesSourceSelection({ initialSeries: withVersions(en, fr), onLoadVersion }),
      );
      mockCurrentlyPlaying = null;
      rerender();
      await waitFor(() => expect(getPreferredSource).toHaveBeenCalled());
      expect(onLoadVersion).not.toHaveBeenCalled();
    });
  });
});
