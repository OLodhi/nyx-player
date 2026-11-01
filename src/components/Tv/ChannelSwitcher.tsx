/**
 * ChannelSwitcher — Layout Sidebar + Grille côte à côte (v2)
 *
 * Affiché par-dessus le player en mode Live TV.
 * Réutilise TvCategoriesSidebar (existant) + ChannelGrid (existant, 2 colonnes).
 * La vidéo MPV est réduite via setVideoMarginRatio({ left: 0.40 }).
 * Téléphone : panneau unique à lignes compactes (ChannelSwitcherCompact).
 */

import React from 'react';
import TvCategoriesSidebar from '../Navigation/TvCategoriesSidebar';
import ChannelGrid from './ChannelGrid';
import ChannelSwitcherCompact from './ChannelSwitcherCompact';
import { isCompactLayout } from '../../utils/layout';
import { inertProps } from '../../utils/inert';
import type { LiveTvData } from '../../hooks/useChannelSwitcher';
import type { IptvStream } from '../../types/iptv';
import './ChannelSwitcher.css';

export interface ChannelSwitcherProps {
  liveTvData: LiveTvData;
  isOpen: boolean;
  selectedCategoryId: string;
  onSelectCategory: (id: string) => void;
  filteredChannels: IptvStream[];
  activeChannelId: number | string;
  onChannelClick: (channel: IptvStream) => void;
  onClose: () => void;
}

const ChannelSwitcher: React.FC<ChannelSwitcherProps> = (props) => {
  if (isCompactLayout()) return <ChannelSwitcherCompact {...props} />;
  const { liveTvData, isOpen, selectedCategoryId, onSelectCategory, filteredChannels, onChannelClick, onClose } = props;
  return (
    <div className={`channel-switcher ${isOpen ? 'channel-switcher--open' : ''}`} {...inertProps(!isOpen)} data-testid="player-channel-switcher">
      {/* Backdrop — ferme le switcher au clic */}
      {isOpen && (
        <div className="channel-switcher__backdrop" data-testid="player-channel-switcher-backdrop" onClick={onClose} />
      )}

      {/* Sidebar catégories — composant existant (override CSS pour position) */}
      <div className={`channel-switcher__sidebar ${isOpen ? 'channel-switcher__sidebar--visible' : ''}`}>
        <TvCategoriesSidebar
          categories={liveTvData.categories.map(c => ({
            category_id: c.category_id,
            category_name: c.category_name,
          }))}
          selectedCategory={selectedCategoryId}
          onSelectCategory={onSelectCategory}
          pinnedCategoryIds={liveTvData.pinnedCategories}
          onTogglePin={liveTvData.togglePin}
          totalChannels={liveTvData.totalChannels}
        />
      </div>

      {/* Grille de chaînes — composant existant, 2 colonnes */}
      <div className={`channel-switcher__grid ${isOpen ? 'channel-switcher__grid--visible' : ''}`}>
        <ChannelGrid
          channels={filteredChannels}
          onChannelClick={onChannelClick}
          maxColumns={2}
        />
      </div>
    </div>
  );
};

export default ChannelSwitcher;
