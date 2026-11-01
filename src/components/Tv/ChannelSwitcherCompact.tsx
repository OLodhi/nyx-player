/**
 * ChannelSwitcherCompact — Liste rapide des chaînes dans le lecteur, sur téléphone.
 *
 * La version bureau / TV (barre de catégories + grille de logos) était tassée en paysage : deux
 * chaînes visibles, les épinglées écrasaient les autres catégories, et la barre de contrôle
 * débordait sur ce qui restait de la vidéo. Ici, un seul panneau (≈ 40 % de la largeur) :
 * - en tête, la catégorie en cours ; un appui ouvre les catégories dans le panneau (TvCategoryList)
 * - des lignes compactes : logo, nom, programme en cours et sa progression, favori
 * - la chaîne en cours est mise en évidence et centrée à l'ouverture
 * Pas de recherche : en paysage, le clavier couvrirait la liste (elle reste sur la page Live TV).
 *
 * Largeur du panneau : ChannelSwitcher.css, à garder identique à computeLeftMarginRatio
 * (useChannelSwitcher.ts), qui réduit la vidéo d'autant.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FixedSizeList, type ListChildComponentProps, type ListOnItemsRenderedProps } from 'react-window';
import ChannelLogo from '../ChannelLogo';
import TvCategoryList, { FAVORITES_CATEGORY_ID } from './TvCategoryList';
import { getFavorites, toggleFavorite } from '../../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../../services/eventConstants';
import { isEpgEnabled } from '../../services/preferencesService';
import { useGridEpg } from '../../hooks/useGridEpg';
import { useBackHandler } from '../../hooks/useBackHandler';
import { clickableProps } from '../../utils/clickable';
import type { EpgNowInfo } from '../../services/epgService';
import type { IptvStream } from '../../types/iptv';
import type { ChannelSwitcherProps } from './ChannelSwitcher';

/** Hauteur d'une ligne en pixels : identique à `.channel-row-slot` (ChannelSwitcher.css) */
export const CHANNEL_ROW_HEIGHT = 56;

/**
 * Programmes en cours chargés par tranches autour des lignes visibles : « Toutes » compte des
 * dizaines de milliers de chaînes, les interroger toutes à chaque ouverture ralentissait le téléphone.
 */
const EPG_PAGE_SIZE = 30;

interface RowData {
  channels: IptvStream[];
  activeChannelId: number | string;
  favorites: Set<number>;
  epgMap: Map<string, EpgNowInfo>;
  onChannelClick: (channel: IptvStream) => void;
  onToggleFavorite: (channelId: number) => void;
  labels: { add: string; remove: string };
}

const HeartIcon: React.FC<{ filled: boolean }> = ({ filled }) => (
  <svg viewBox="0 0 192.6 172.24" fill="currentColor" aria-hidden="true">
    {filled ? (
      <path d="M143.2,0c-13.34,0-25.84,5.53-35.21,15.57l-4.54,4.86s-3.58,3.84-7.16,7.67l-7.16-7.67-4.54-4.86C75.24,5.53,62.73,0,49.39,0S23.55,5.53,14.18,15.57c-18.91,20.27-18.91,53.26,0,73.54l74.96,75.89,7.16,7.24c3.58-3.62,7.16-7.24,7.16-7.24l74.96-75.89c18.91-20.28,18.91-53.27,0-73.54-9.37-10.04-21.87-15.57-35.21-15.57h0Z" />
    ) : (
      <path d="M143.2,20c7.85,0,14.96,3.19,20.59,9.21,11.64,12.48,11.69,33.51.17,46.08l-67.66,68.5L28.64,75.29c-11.52-12.56-11.47-33.6.17-46.08,5.62-6.03,12.74-9.21,20.59-9.21s14.96,3.19,20.59,9.21l4.54,4.86,7.16,7.67,14.62,15.68,14.62-15.68,7.16-7.67,4.54-4.86c5.62-6.03,12.74-9.21,20.59-9.21M143.2,0c-13.34,0-25.84,5.53-35.21,15.57l-4.54,4.86s-3.58,3.84-7.16,7.67l-7.16-7.67-4.54-4.86C75.24,5.53,62.73,0,49.39,0S23.55,5.53,14.18,15.57c-18.91,20.27-18.91,53.26,0,73.54l74.96,75.89,7.16,7.24c3.58-3.62,7.16-7.24,7.16-7.24l74.96-75.89c18.91-20.28,18.91-53.27,0-73.54-9.37-10.04-21.87-15.57-35.21-15.57h0Z" />
    )}
  </svg>
);

const ChannelRow: React.FC<ListChildComponentProps<RowData>> = ({ index, style, data }) => {
  const channel = data.channels[index];
  const channelId = Number(channel.stream_id);
  const isActive = String(channel.stream_id) === String(data.activeChannelId);
  const isFavorite = data.favorites.has(channelId);
  const epgId = channel.matched_epg_id || channel.epg_channel_id;
  const epg = epgId ? data.epgMap.get(epgId) : undefined;
  const open = () => data.onChannelClick(channel);

  return (
    <div style={style} className="channel-row-slot">
      <div
        className={`channel-row${isActive ? ' channel-row--active' : ''}`}
        data-testid="player-channel-row"
        {...clickableProps(open)}
        onClick={open}
        aria-current={isActive ? 'true' : undefined}
      >
        <ChannelLogo channelName={channel.name} xtreamIcon={channel.stream_icon} size="small" />
        <div className="channel-row__text">
          <span className="channel-row__name">{channel.name}</span>
          {epg && (
            <>
              <span className="channel-row__epg-title">{epg.title}</span>
              <span className="channel-row__epg-bar">
                <span className="channel-row__epg-fill" style={{ width: `${epg.progress}%` }} />
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          className={`channel-row__favorite${isFavorite ? ' active' : ''}`}
          data-testid="player-channel-favorite"
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleFavorite(channelId);
          }}
          aria-label={isFavorite ? data.labels.remove : data.labels.add}
          aria-pressed={isFavorite}
        >
          <HeartIcon filled={isFavorite} />
        </button>
      </div>
    </div>
  );
};

const ChannelSwitcherCompact: React.FC<ChannelSwitcherProps> = ({
  liveTvData,
  isOpen,
  selectedCategoryId,
  onSelectCategory,
  filteredChannels,
  activeChannelId,
  onChannelClick,
  onClose,
}) => {
  const { t } = useTranslation('tv');
  const [picking, setPicking] = useState(false);
  const [listHeight, setListHeight] = useState(0);
  const [epgPage, setEpgPage] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<FixedSizeList<RowData>>(null);

  // Liste refermée (bouton « Chaînes TV », tap sur la vidéo) : elle rouvrira sur les chaînes
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) setPicking(false);
  }

  // Retour : referme d'abord les catégories, la liste elle-même a son retour (useChannelSwitcher)
  useBackHandler(isOpen && picking, () => setPicking(false));

  // Hauteur disponible pour la liste virtualisée
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const update = () => setListHeight(body.clientHeight);
    const frame = requestAnimationFrame(update);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(body);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Favoris (cache synchrone du service, mis à jour par événement comme la grille)
  const [favoritesVersion, setFavoritesVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setFavoritesVersion((v) => v + 1);
    window.addEventListener(LIVE_TV_BOOKMARKS_EVENT, refresh);
    return () => window.removeEventListener(LIVE_TV_BOOKMARKS_EVENT, refresh);
  }, []);
  const favorites = useMemo(() => {
    void favoritesVersion;
    return getFavorites();
  }, [favoritesVersion]);
  const handleToggleFavorite = useCallback((channelId: number) => {
    void toggleFavorite(channelId);
    setFavoritesVersion((v) => v + 1);
  }, []);

  // Programmes en cours : seulement autour des lignes affichées
  const epgChannels = useMemo(
    () => filteredChannels.slice(Math.max(0, epgPage - 1) * EPG_PAGE_SIZE, (epgPage + 2) * EPG_PAGE_SIZE),
    [filteredChannels, epgPage],
  );
  const epgMap = useGridEpg(epgChannels, isOpen && isEpgEnabled());
  const handleItemsRendered = useCallback(({ visibleStartIndex }: ListOnItemsRenderedProps) => {
    setEpgPage(Math.floor(visibleStartIndex / EPG_PAGE_SIZE));
  }, []);

  // Chaîne en cours centrée à l'ouverture et au retour sur la liste (pas à chaque zapping)
  const activeIndex = useMemo(
    () => filteredChannels.findIndex((c) => String(c.stream_id) === String(activeChannelId)),
    [filteredChannels, activeChannelId],
  );
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  });
  useEffect(() => {
    if (!isOpen || picking || listHeight === 0) return;
    const index = activeIndexRef.current;
    listRef.current?.scrollToItem(Math.max(index, 0), index >= 0 ? 'center' : 'start');
  }, [isOpen, picking, listHeight, selectedCategoryId]);

  const categoryName = useMemo(() => {
    if (selectedCategoryId === FAVORITES_CATEGORY_ID) return t('sidebar_favorites');
    return liveTvData.categories.find((c) => c.category_id === selectedCategoryId)?.category_name ?? t('sidebar_all');
  }, [selectedCategoryId, liveTvData.categories, t]);

  const rowData: RowData = useMemo(() => ({
    channels: filteredChannels,
    activeChannelId,
    favorites,
    epgMap,
    onChannelClick,
    onToggleFavorite: handleToggleFavorite,
    labels: { add: t('favorite_add'), remove: t('favorite_remove') },
  }), [filteredChannels, activeChannelId, favorites, epgMap, onChannelClick, handleToggleFavorite, t]);

  return (
    <div className={`channel-switcher-compact${isOpen ? ' channel-switcher-compact--open' : ''}`} data-testid="player-channel-switcher">
      {isOpen && <div className="channel-switcher-compact__backdrop" data-testid="player-channel-switcher-backdrop" onClick={onClose} />}

      <div className="channel-switcher-compact__panel" aria-hidden={!isOpen}>
        <button
          type="button"
          className={`channel-switcher-compact__picker${picking ? ' open' : ''}`}
          data-testid="player-channel-picker"
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
        >
          <span className="channel-switcher-compact__picker-name">{categoryName}</span>
          {!picking && <span className="channel-switcher-compact__picker-count">{filteredChannels.length}</span>}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <div ref={bodyRef} className="channel-switcher-compact__body">
          {picking ? (
            <TvCategoryList
              categories={liveTvData.categories}
              selectedCategory={selectedCategoryId}
              onSelectCategory={(categoryId) => {
                onSelectCategory(categoryId);
                setPicking(false);
              }}
              pinnedCategoryIds={liveTvData.pinnedCategories}
              onTogglePin={liveTvData.togglePin}
              totalChannels={liveTvData.totalChannels}
            />
          ) : filteredChannels.length === 0 ? (
            <p className="channel-switcher-compact__empty">{t('no_channels_category')}</p>
          ) : listHeight > 0 && (
            <FixedSizeList
              ref={listRef}
              className="scrollbar-thin"
              height={listHeight}
              width="100%"
              itemCount={filteredChannels.length}
              itemSize={CHANNEL_ROW_HEIGHT}
              itemData={rowData}
              overscanCount={4}
              onItemsRendered={handleItemsRendered}
            >
              {ChannelRow}
            </FixedSizeList>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChannelSwitcherCompact;
