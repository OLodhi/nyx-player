import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { XtreamEpisode } from '../../types/xtream';
import { clickableProps } from '../../utils/clickable';

interface PlayerEpisodeListItemProps {
  episode: XtreamEpisode;
  episodeNum: number;
  isActive: boolean;
  onClick: (episode: XtreamEpisode) => void;
  posterFallback: string;
  tmdbTitle?: string;
  tmdbImage?: string | null;
  isLoading?: boolean;
}

const PlayerEpisodeListItem: React.FC<PlayerEpisodeListItemProps> = ({
  episode,
  episodeNum,
  isActive,
  onClick,
  posterFallback,
  tmdbTitle,
  tmdbImage,
  isLoading,
}) => {
  const { t } = useTranslation('details');

  // Affichage du Skeleton Loading
  if (isLoading) {
    return (
      <div className="episode-list-item is-loading">
        <div className="epi-thumbnail-container"></div>
        <div className="epi-details">
          <div className="epi-title-row">
            {/* eslint-disable-next-line i18next/no-literal-string -- numéro factice du squelette de chargement */}
            <span className="epi-number">0.</span>
            <span className="epi-title">{t('loading')}</span>
          </div>
          {/* eslint-disable-next-line i18next/no-literal-string -- texte de remplissage du squelette de chargement (même notation en français et en anglais) */}
          <div className="epi-runtime">-- min</div>
        </div>
      </div>
    );
  }

  // Priorité TMDB > Xtream > Fallback
  const episodeBadge = `E${episodeNum}`;
  const customTitle = tmdbTitle || episode.title;
  const fullAltTitle = customTitle ? `${episodeBadge} - ${customTitle}` : t('episode_label_badge', { count: episodeNum });
  const runtime = episode.info?.duration || episode.duration;
  const imageUrl = tmdbImage || episode.info?.movie_image || posterFallback;

  return (
    <div 
      className={`episode-list-item ${isActive ? 'is-active' : ''}`}
      data-testid="player-episode"
      onClick={() => onClick(episode)}
      {...clickableProps(() => onClick(episode))}
    >
      <div className="epi-thumbnail-container">
        <img 
          src={imageUrl} 
          alt={fullAltTitle} 
          loading="lazy"
          draggable={false}
          className="epi-thumbnail"
          onError={(e) => {
             const img = e.target as HTMLImageElement;
             // Guard: éviter boucle infinie si posterFallback est vide ou déjà défini
             if (posterFallback && img.src !== posterFallback) {
               img.src = posterFallback;
             }
          }}
        />
        {isActive && (
          <div className="epi-playing-indicator">
            <span className="epi-playing-bars"></span>
            <span className="epi-playing-bars"></span>
            <span className="epi-playing-bars"></span>
          </div>
        )}
      </div>
      
      <div className="epi-details">
        <div className="epi-title-row">
          <span className="epi-title">
            {customTitle && <span className="epi-number">{episodeBadge} - </span>}
            {customTitle || t('episode_label_badge', { count: episodeNum })}
          </span>
        </div>
        {runtime && <div className="epi-runtime">{runtime} {t('duration_min')}</div>}
      </div>
    </div>
  );
};

export default memo(PlayerEpisodeListItem);
