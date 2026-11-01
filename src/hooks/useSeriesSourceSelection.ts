import { useState, useEffect, useRef } from 'react';
import type { AppSeriesInfo } from '../types/xtream';
import type { IptvSeries } from '../types/iptv';
import { usePlayer } from '../contexts/PlayerContext';
import { getPreferredSource, setPreferredSource } from '../services/contentPreferencesService';
import { selectBestSourceIndex } from '../utils/sourceLanguageSelector';
import { getAppLanguage } from '../utils/tmdbLanguage';
import { warnOnReject } from '../utils/warnOnReject';

interface UseSeriesSourceSelectionParams {
  initialSeries: AppSeriesInfo;
  onLoadVersion?: (seriesId: number) => Promise<IptvSeries | null>;
}

/**
 * Hook de gestion de la source sélectionnée pour SeriesDetailPage.
 * 
 * Responsabilités :
 * - State selectedSource avec init par langue (selectBestSourceIndex)
 * - Auto-persist de la sélection langue au premier mount
 * - Restore depuis SQLite (preferred source)
 * - Re-sync au retour du player (prevPlayingRef)
 * - Persistance au changement utilisateur
 */
export function useSeriesSourceSelection({
  initialSeries,
  onLoadVersion,
}: UseSeriesSourceSelectionParams) {
  const groupedVersions = initialSeries.groupedVersions || [initialSeries];

  // Language-based selection for first visit
  const [selectedSource, setSelectedSource] = useState<IptvSeries>(() => {
    if (groupedVersions.length <= 1) return initialSeries;
    const bestIndex = selectBestSourceIndex(
      groupedVersions.map(v => v.name),
      getAppLanguage(),
    );
    return groupedVersions[bestIndex] || initialSeries;
  });
  const series = selectedSource as AppSeriesInfo;

  const hasUserChangedSource = useRef(false);

  // Auto-persist language-based selection (first visit only)
  useEffect(() => {
    const tmdbId = initialSeries.tmdb;
    if (
      tmdbId && tmdbId > 0 &&
      !hasUserChangedSource.current &&
      groupedVersions.length > 1
    ) {
      getPreferredSource('series', tmdbId).then(existing => {
        if (existing === null) {
          void setPreferredSource('series', tmdbId, Number(selectedSource.series_id));
        }
      }).catch(warnOnReject('SeriesSource'));
    }
    // Mount-only: auto-persist language-based selection on first visit.
    // Deps intentionally omitted (initialSeries.tmdb, selectedSource, groupedVersions)
    // to avoid re-running on subsequent state changes.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- au premier affichage seulement, voir ci-dessus

  // Watch currentlyPlaying for re-sync on player close
  const { currentlyPlaying } = usePlayer();
  const prevPlayingRef = useRef(currentlyPlaying);

  useEffect(() => {
    const wasPlaying = prevPlayingRef.current;
    prevPlayingRef.current = currentlyPlaying;

    const playerJustClosed = wasPlaying !== null && currentlyPlaying === null;
    if (!playerJustClosed && hasUserChangedSource.current) return;

    const tmdbId = initialSeries.tmdb;
    if (!tmdbId || tmdbId <= 0) return;

    getPreferredSource('series', tmdbId).then(async (savedId) => {
      if (savedId === null) return;
      if (Number(selectedSource.series_id) === savedId) return;

      const found = groupedVersions.find(v => Number(v.series_id) === savedId);
      if (found && onLoadVersion) {
        const loaded = await onLoadVersion(Number(found.series_id));
        if (loaded) {
          setSelectedSource(loaded);
        }
      }
    }).catch(warnOnReject('SeriesSource'));
    // Re-sync on player close only.
    // Deps intentionally limited to initialSeries.tmdb + currentlyPlaying.
    // selectedSource/groupedVersions/onLoadVersion are read but not tracked to avoid loops.
  }, [initialSeries.tmdb, currentlyPlaying]); // eslint-disable-line react-hooks/exhaustive-deps -- au retour du lecteur seulement ; suivre la source choisie bouclerait



  const handleSourceChange = async (version: { id: number; name: string }) => {
    if (version.id === Number(series.series_id)) return;

    // Persist to SQLite
    const tmdbId = series.tmdb;
    if (tmdbId && tmdbId > 0) {
      void setPreferredSource('series', tmdbId, version.id);
    }
    hasUserChangedSource.current = true;

    // JIT Hydration
    if (onLoadVersion) {
      const loaded = await onLoadVersion(version.id);
      if (loaded) {
        setSelectedSource(loaded);
      }
    } else {
      const found = groupedVersions.find(v => Number(v.series_id) === version.id);
      if (found) setSelectedSource(found);
    }
  };

  return {
    series,
    selectedSource,
    setSelectedSource,
    hasUserChangedSource,
    groupedVersions,
    handleSourceChange,
  };
}
