import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { dismissKeyboardOnScroll } from '../utils/keyboard';
import { isTv } from '../utils/platform';
import { QUIET_IME_PROPS } from '../utils/spatialNavigation';
import { useTranslation } from 'react-i18next';
import type { LightMovie, LightSeries, LightLive, LightIndexes } from '../types/lightIndex';
import { getIconUrl } from '../types/lightIndex';
import type { NavigateToContent } from '../types/navigation';
import ContentCarousel, { CarouselItem } from '../components/Lists/ContentCarousel';
import ChannelCard from '../components/Tv/ChannelCard';
import { useInertiaScroll } from '../hooks/useInertiaScroll';
import { useGlobalSearch } from '../hooks/useGlobalSearch';
import { usePlayer } from '../contexts/PlayerContext';
import { useDevOverrides } from '../contexts/DevOverrideContext';
import { getFavorites, toggleFavorite } from '../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../services/eventConstants';
import type { IptvStream } from '../types/iptv';
import searchIcon from '../assets/icons/search.svg';
import filmIcon from '../assets/icons/film.svg';
import starIcon from '../assets/icons/star.svg';
import screenIcon from '../assets/icons/screen.svg';
import './GlobalSearchPage.css';

/* ── TvCarouselSection — defined at module level for stable component identity ── */
interface TvCarouselSectionProps {
  items: LightLive[];
  onPlay: (item: LightLive) => void;
  prefixes: string[];
  favorites: Set<number>;
  onToggleFavorite: (e: React.MouseEvent | undefined, channelId: number) => void;
}

export const TvCarouselSection: React.FC<TvCarouselSectionProps> = ({ items, onPlay: playItem, prefixes, favorites, onToggleFavorite }) => {
  const { t } = useTranslation('search');
  const { ref, isDragging, handleMouseDown, dragStarted } = useInertiaScroll();

  return (
    <div className="tv-carousel-section">
      <h3 className="carousel-title">
        <img src={screenIcon} alt="" className="carousel-title__icon" />
        {t('tv_title', { count: items.length })}
      </h3>
      <div
        ref={ref}
        className={`tv-carousel-track ${isDragging ? 'dragging' : ''}`}
        data-testid="search-tv-track"
        data-nav-row
        onMouseDown={handleMouseDown}
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="search-tv-card-wrapper"
            data-testid="search-tv-card"
            onClick={() => {
              if (!dragStarted) playItem(item);
            }}
          >
            <ChannelCard
              channelName={item.name}
              streamIcon={getIconUrl(item, prefixes)}
              onClick={() => { }}
              isFavorite={favorites.has(item.id)}
              onToggleFavorite={(e) => {
                if (!dragStarted) onToggleFavorite(e, item.id);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── GlobalSearchPage ── */
interface GlobalSearchPageProps {
  onNavigateToContent: NavigateToContent;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  lightIndexes?: LightIndexes;
}

const GlobalSearchPage: React.FC<GlobalSearchPageProps> = ({
  onNavigateToContent,
  searchQuery,
  onSearchChange,
  lightIndexes,
}) => {
  const { t } = useTranslation('search');
  const { play } = usePlayer();

  // DevPanel overrides
  const { overrides, setActivePage } = useDevOverrides();
  const go = overrides.globalSearchPage;

  // Register active page for DevPanel detection
  useEffect(() => {
    setActivePage('GlobalSearchPage');
  }, [setActivePage]);

  // Search Hook with SQLite FTS5 (replaces FlexSearch)
  const { results, debouncedQuery } = useGlobalSearch(lightIndexes || null, searchQuery);

  // Icon URL prefixes for reconstruction
  const iconPrefixes = useMemo(() => lightIndexes?.iconPrefixes || [], [lightIndexes?.iconPrefixes]);

  // ---- Favoris TV (liveTvBookmarksService) ----
  const [favoritesVersion, setFavoritesVersion] = useState(0);

  useEffect(() => {
    const handler = () => setFavoritesVersion(v => v + 1);
    window.addEventListener(LIVE_TV_BOOKMARKS_EVENT, handler);
    return () => window.removeEventListener(LIVE_TV_BOOKMARKS_EVENT, handler);
  }, []);

  const tvFavorites = useMemo(() => {
    void favoritesVersion;
    return getFavorites();
  }, [favoritesVersion]);

  const handleToggleTvFavorite = useCallback((e: React.MouseEvent | undefined, channelId: number) => {
    e?.stopPropagation();
    void toggleFavorite(channelId);
    setFavoritesVersion(v => v + 1);
  }, []);

  // Helper to navigate to content using LightItems
  const navigateToMovie = useCallback((movie: LightMovie) => {
    onNavigateToContent('movie', {
      tmdbId: movie.tmdbId,
      streamId: movie.id,
    });
  }, [onNavigateToContent]);

  const navigateToSeries = useCallback((series: LightSeries) => {
    onNavigateToContent('series', {
      tmdbId: series.tmdbId,
      seriesId: series.id,
    });
  }, [onNavigateToContent]);

  // Focus input on mount
  useEffect(() => {
    const input = document.getElementById('global-search-input');
    if (input) input.focus();
  }, []);

  // Results are PRE-GROUPED by useGlobalSearch hook
  const groupedMovies = results.movies;
  const groupedSeries = results.series;

  // Films mapped to CarouselItem[]
  const movieCarouselItems = useMemo<CarouselItem[]>(() => {
    return groupedMovies.map((group) => {
      const item = group.representative;
      const imageUrl = getIconUrl(item, iconPrefixes);

      return {
        id: item.id,
        title: item.name,
        image: imageUrl,
        mediaType: 'movie' as const,
        overlayText: group.sourceCount > 1 ? `${group.sourceCount} sources` : undefined,
        onClick: () => navigateToMovie(item),
        // Watchlist managed by ContentCarousel async (tmdbId/streamId passed)
        tmdbId: item.tmdbId,
        streamId: item.id,
      };
    });
  }, [groupedMovies, iconPrefixes, navigateToMovie]);

  // Séries mapped to CarouselItem[]
  const seriesCarouselItems = useMemo<CarouselItem[]>(() => {
    return groupedSeries.map((group) => {
      const item = group.representative;
      const imageUrl = getIconUrl(item, iconPrefixes);

      return {
        id: item.id,
        title: item.name,
        image: imageUrl,
        mediaType: 'series' as const,
        overlayText: group.sourceCount > 1 ? `${group.sourceCount} sources` : undefined,
        onClick: () => navigateToSeries(item),
        tmdbId: item.tmdbId,
        streamId: item.id,
      };
    });
  }, [groupedSeries, iconPrefixes, navigateToSeries]);

  // ---- Mock data generator for DevPanel ----
  const mockCarouselItems = useMemo<CarouselItem[]>(() => {
    if (go.forceManyResults === null || go.forceManyResults <= 0) return [];
    const titles = [
      'The Shawshank Redemption', 'Inception', 'Interstellar', 'The Dark Knight',
      'Pulp Fiction', 'Fight Club', 'Forrest Gump', 'The Matrix', 'Goodfellas',
      'The Godfather', 'Breaking Bad', 'Stranger Things', 'The Witcher',
    ];
    return Array.from({ length: go.forceManyResults }, (_, i) => ({
      id: 90000 + i,
      title: titles[i % titles.length] + (i >= titles.length ? ` ${Math.floor(i / titles.length) + 1}` : ''),
      image: '',
      mediaType: (i % 2 === 0 ? 'movie' : 'series') as 'movie' | 'series',
    }));
  }, [go.forceManyResults]);

  const mockLiveItems = useMemo<LightLive[]>(() => {
    if (go.forceManyResults === null || go.forceManyResults <= 0) return [];
    const channels = ['TF1', 'France 2', 'M6', 'Arte', 'Canal+', 'BFM TV', 'TMC', 'W9', 'NRJ 12', 'C8'];
    return Array.from({ length: Math.min(go.forceManyResults, 15) }, (_, i) => ({
      id: 80000 + i,
      name: channels[i % channels.length] + (i >= channels.length ? ` ${Math.floor(i / channels.length) + 1}` : ''),
      categoryId: '1',
      iconPrefixId: -1,
      iconSuffix: '',
    }));
  }, [go.forceManyResults]);

  // ---- Apply DevPanel overrides ----
  const effectiveMovies = go.forceManyResults !== null && go.forceManyResults > 0
    ? mockCarouselItems.filter(i => i.mediaType === 'movie')
    : movieCarouselItems;
  const effectiveSeries = go.forceManyResults !== null && go.forceManyResults > 0
    ? mockCarouselItems.filter(i => i.mediaType === 'series')
    : seriesCarouselItems;
  const effectiveLive = go.forceManyResults !== null && go.forceManyResults > 0
    ? mockLiveItems
    : results.live;
  const effectiveTotal = go.forceNoResults
    ? 0
    : (effectiveMovies.length + effectiveSeries.length + effectiveLive.length);
  const effectiveError = go.forceError;

  // TvCarouselSection is now defined at module-level for stable identity

  return (
    <div className="global-search-page" data-testid="search-page" data-nav-cadence>
      <div className="search-header">
        <div className="search-input-wrapper">
          <span className="search-icon"><img src={searchIcon} alt="" /></span>
          <input
            id="global-search-input"
            data-testid="search-input"
            className="global-search-input"
            type="text"
            placeholder={t('placeholder_global')}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              // Android garde le clavier ouvert apres « Rechercher » : il masque les resultats
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            enterKeyHint="search"
            autoComplete="off"
            autoFocus
            // TV : le champ est sélectionné à l'arrivée, mais seul OK ouvre le clavier (ANDROID_TV_PLAN.md)
            {...(isTv() ? QUIET_IME_PROPS : {})}
          />
        </div>
      </div>

      <div className="search-content-area scrollbar-thin" onScroll={dismissKeyboardOnScroll}>
        {effectiveError ? (
          <div className="no-results">
            <span className="no-results__error-icon">⚠</span>
            <p>{effectiveError}</p>
          </div>
        ) : !debouncedQuery && !go.forceManyResults ? (
          <div className="no-results" data-testid="search-start">
            <img src={searchIcon} alt="" className="no-results__icon" />
            <p>{t('start_typing')}</p>
          </div>
        ) : effectiveTotal === 0 ? (
          <div className="no-results" data-testid="search-no-results">
            <p>{t('no_results', { query: debouncedQuery })}</p>
          </div>
        ) : (
          <div className="all-results-view">
            {/* Films Carousel */}
            {effectiveMovies.length > 0 && (
              <ContentCarousel
                title={t('movies_title', { count: effectiveMovies.length })}
                items={effectiveMovies}
                titleIcon={<img src={filmIcon} alt="" className="carousel-title__icon" />}
              />
            )}

            {/* Séries Carousel */}
            {effectiveSeries.length > 0 && (
              <ContentCarousel
                title={t('series_title', { count: effectiveSeries.length })}
                items={effectiveSeries}
                titleIcon={<img src={starIcon} alt="" className="carousel-title__icon" />}
              />
            )}

            {/* TV Carousel */}
            {effectiveLive.length > 0 && (
              <TvCarouselSection
                items={effectiveLive}
                onPlay={(item: LightLive) => {
                  void play({
                    stream_id: item.id,
                    name: item.name,
                    stream_type: 'live',
                    stream_icon: getIconUrl(item, iconPrefixes),
                    category_id: item.categoryId,
                    epg_channel_id: item.epgChannelId,
                    matched_epg_id: item.matchedEpgId,
                    match_method: item.matchMethod,
                  } as IptvStream);
                }}
                prefixes={iconPrefixes}
                favorites={tvFavorites}
                onToggleFavorite={handleToggleTvFavorite}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearchPage;
