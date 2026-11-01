import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSeriesInfo, XtreamEpisode } from '../../types/xtream';
import type { PlayableItem } from '../../types/player';
import PlayerEpisodeListItem from './PlayerEpisodeListItem';
import { findEpisodeSeason } from '../../utils/episodeNavigation';
import { requestMemoryPurge } from '../../services/memoryService';
import tmdb from '../../services/tmdbApi';
import { useTmdbSeries } from '../../hooks/useTmdbSeries';
import NyxDropdown from '../Common/NyxDropdown';
import { inertProps } from '../../utils/inert';
import './EpisodeSwitcher.css';

interface EpisodeSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  currentSeries: AppSeriesInfo | null;
  currentlyPlaying: PlayableItem | null;
  onPlayEpisode: (episode: XtreamEpisode, series: AppSeriesInfo) => Promise<void>;
  /** DevPanel override: force le skeleton loading sur les items */
  forceSkeletonLoading?: boolean;
}

const EpisodeSwitcher: React.FC<EpisodeSwitcherProps> = ({
  isOpen,
  onClose,
  currentSeries,
  currentlyPlaying,
  onPlayEpisode,
  forceSkeletonLoading = false,
}) => {
  const { t } = useTranslation('details');
  const [selectedSeason, setSelectedSeason] = useState<string>('');
  const listRef = useRef<HTMLDivElement>(null);
  const hadImagesRef = useRef(false); // Track si des images ont été rendues
  const isTransitioningOutRef = useRef(false); // Guard: empêche les re-renders pendant la transition CSS de fermeture

  // Hook TMDB pour récupérer les noms & images HQ 
  // (Utilise silencieusement le cache SQLite sans spam réseau)
  // Objet safe pour le hook quand forceSeriesMode est actif sans série
  const safeSeries = currentSeries ?? ({ series_id: 0, name: '', episodes: {} } as AppSeriesInfo);
  const { currentSeasonEpisodes, isSeasonLoading } = useTmdbSeries(
    safeSeries, 
    Number(selectedSeason) || 1
  );

  // Auto-select season based on currently playing or default to first season
  useEffect(() => {
    if (!currentSeries?.episodes || !isOpen) return;
    
    // Si on a un épisode en cours, on essaye de trouver sa saison
    if (currentlyPlaying && 'id' in currentlyPlaying) {
      const activeSeason = findEpisodeSeason(currentSeries.episodes, String(currentlyPlaying.id));
      if (activeSeason !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- saison de l'épisode en cours, choisie à l'ouverture seulement (un choix manuel n'est pas écrasé)
        setSelectedSeason(String(activeSeason));
        return;
      }
    }
    
    // Fallback: prendre la première saison numériquement
    const seasons = Object.keys(currentSeries.episodes).sort((a, b) => Number(a) - Number(b));
    if (seasons.length > 0 && !selectedSeason) {
      setSelectedSeason(seasons[0]);
    }
    // Voulu : la saison n'est choisie qu'à l'ouverture ou au changement d'épisode. Avec selectedSeason
    // en dépendance, chaque saison choisie à la main serait aussitôt remplacée par celle de l'épisode en cours.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedSeason lu sans abonnement
  }, [currentSeries, currentlyPlaying, isOpen]);

  // Scroll intelligent : vers l'épisode actif à l'ouverture UNIQUEMENT, en haut au changement de saison
  useEffect(() => {
    if (!isOpen || !listRef.current) return; // ← Guard: ne PAS scroller à la fermeture
    // Petit délai pour que le DOM soit peint après l'animation de slide-in (300ms)
    const timer = setTimeout(() => {
      if (!listRef.current) return;
      const activeEl = listRef.current.querySelector('.is-active');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else {
        listRef.current.scrollTop = 0;
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [isOpen, selectedSeason]);

  // Transition guard: quand isOpen passe à false, bloquer les re-renders pendant 350ms
  // (durée de la transition CSS) pour éviter que useTmdbSeries ne reset le transform
  useEffect(() => {
    if (isOpen) {
      isTransitioningOutRef.current = false;
    } else {
      isTransitioningOutRef.current = true;
      const timer = setTimeout(() => {
        isTransitioningOutRef.current = false;
        // Memory purge différée APRÈS la transition (si des images ont été chargées)
        if (hadImagesRef.current) {
          requestMemoryPurge();
          hadImagesRef.current = false;
        }
      }, 400); // 300ms transition + 100ms marge
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const seasonsList = useMemo(() => {
    if (!currentSeries?.episodes) return [];
    return Object.keys(currentSeries.episodes).sort((a, b) => Number(a) - Number(b));
  }, [currentSeries]);

  const dropdownOptions = useMemo(() => {
    return seasonsList.map(s => ({
      value: s,
      label: t('select_season', { num: s })
    }));
  }, [seasonsList, t]);

  const activeEpisodes = useMemo(() => {
    if (!currentSeries?.episodes || !selectedSeason) return [];
    return currentSeries.episodes[selectedSeason] || [];
  }, [currentSeries, selectedSeason]);

  // Des épisodes (et leurs images) ont été montrés : purge mémoire à prévoir après la fermeture
  useEffect(() => {
    if (isOpen && activeEpisodes.length > 0) hadImagesRef.current = true;
  }, [isOpen, activeEpisodes]);

  const handleEpisodeClick = useCallback((episode: XtreamEpisode) => {
    if (!currentSeries) return;
    
    // Fermer l'UI immédiatement pour un feedback rapide
    onClose();
    
    // Lancer la lecture avec le contexte de la série
    void onPlayEpisode(episode, currentSeries);
  }, [currentSeries, onClose, onPlayEpisode]);

  const currentlyPlayingId = currentlyPlaying && 'id' in currentlyPlaying 
    ? String(currentlyPlaying.id) 
    : undefined;

  return (
    <>
      {/* Backdrop invisible pour capter le clic en dehors — toujours dans le DOM pour éviter le re-layout */}
      <div 
        className={`episode-switcher-backdrop ${isOpen ? 'is-active' : ''}`}
        data-testid="player-episodes-backdrop"
        onClick={(e) => {
          if (!isOpen) return;
          e.stopPropagation();
          onClose();
        }} 
      />
      <div className={`episode-switcher-overlay ${isOpen ? 'is-open' : ''}`} data-testid="player-episode-switcher" {...inertProps(!isOpen)}>
        {currentSeries ? (
        <>
          <div className="episode-switcher-header">
            <h3 className="episode-switcher-title">{currentSeries.tmdbTitle || currentSeries.name}</h3>
            {seasonsList.length > 0 && (
              <NyxDropdown
                testId="player-episodes-season"
                value={selectedSeason}
                options={dropdownOptions}
                onChange={setSelectedSeason}
              />
            )}
          </div>
          
          <div className="episode-switcher-list scrollbar-thin" ref={listRef}>
            {/* Ne pas re-render la liste pendant la transition de fermeture ; ouverte, elle s'affiche
                toujours (avant : rouverte avant la fin de la transition, la garde était encore levée) */}
            {/* eslint-disable-next-line react-hooks/refs -- garde de fermeture lue au rendu, voulu : seule une fermeture en cours vide la liste */}
            {(isOpen || !isTransitioningOutRef.current) && activeEpisodes.map((ep) => {
               const episodeNum = ep.episode_num || 1;
               const isActive = currentlyPlayingId === String(ep.id);
               
               // Extraction des méta-données TMDB HD
               const tmdbEp = currentSeasonEpisodes[episodeNum];
               
               return (
                 <PlayerEpisodeListItem
                   key={ep.id}
                   episode={ep}
                   episodeNum={episodeNum}
                   isActive={isActive}
                   onClick={handleEpisodeClick}
                   posterFallback={currentSeries.cover || ''}
                   tmdbTitle={tmdbEp?.name}
                   tmdbImage={tmdb.imageUrl(tmdbEp?.still_path || null, 'w342')}
                   isLoading={forceSkeletonLoading || isSeasonLoading}
                 />
               );
            })}
          </div>
        </>
      ) : (
        <div className="episode-switcher-loading">
            <div className="episode-spinner" />
            <span>{t('loading', 'Chargement...')}</span>
        </div>
      )}
      </div>
    </>
  );
};

export default EpisodeSwitcher;
