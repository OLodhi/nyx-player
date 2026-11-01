/**
 * Lecteur — barre du haut : titre (film, chaîne, ou série avec saison et épisode) et fermeture.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SeriesMetadata } from '../../../types/player';

interface PlayerTopBarProps {
  title: string;
  seriesMetadata?: SeriesMetadata;
  onClose: () => void;
}

const PlayerTopBar: React.FC<PlayerTopBarProps> = ({ title, seriesMetadata, onClose }) => {
  const { t } = useTranslation('player');
  return (
    <div className="player-top-bar">
      <div className="player-title" data-testid="player-title" data-value={title}>
        {seriesMetadata
          ? `${seriesMetadata.seriesNameTmdb || seriesMetadata.seriesName} - ${t('series_episode_title', { season: seriesMetadata.seasonNumber, episode: seriesMetadata.episodeNumber })}`
          : title}
      </div>
      <button className="player-close-btn" onClick={onClose} data-testid="player-close">
        ✕
      </button>
    </div>
  );
};

export default PlayerTopBar;
