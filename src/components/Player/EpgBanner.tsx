/**
 * EpgBanner — Bandeau EPG overlay pour le player Live TV.
 *
 * Position : coin bas-gauche (style TV-box).
 * Affiche : programme en cours (titre + horaires + progression + description)
 *         + programme suivant.
 * Description toujours visible, fade-out gradient si texte trop long.
 * Suit la visibilité des contrôles player (SmartLock).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import ChannelLogo from '../ChannelLogo';
import type { EpgNowInfo } from '../../services/epgService';
import { formatClock } from '../../utils/timeHelpers';
import './EpgBanner.css';

interface EpgBannerProps {
  channelName: string;
  streamIcon?: string;
  nowProgram: EpgNowInfo | null;
  nextProgram: EpgNowInfo | null;
  isVisible: boolean;
}

/** Formate une plage horaire "HH:MM - HH:MM" */
function formatTimeRange(startTs: number, stopTs: number): string {
  return `${formatClock(startTs)} - ${formatClock(stopTs)}`;
}

const EpgBanner: React.FC<EpgBannerProps> = ({
  channelName,
  streamIcon,
  nowProgram,
  nextProgram,
  isVisible,
}) => {
  const { t } = useTranslation('player');
  // Rien à afficher si pas de programme
  if (!nowProgram) return null;

  return (
    <div className={`epg-banner ${isVisible ? 'epg-banner--visible' : 'epg-banner--hidden'}`}>
      {/* Header : Logo + Nom chaîne */}
      <div className="epg-banner__header">
        <div className="epg-banner__logo">
          <ChannelLogo
            channelName={channelName}
            xtreamIcon={streamIcon}
            size="large"
          />
        </div>
        <div className="epg-banner__channel">{channelName}</div>
      </div>

      {/* Programme en cours */}
      <div className="epg-banner__now">
        <span className="epg-banner__now-label">▶</span>
        <span className="epg-banner__now-title">{nowProgram.title}</span>
        <span className="epg-banner__now-time">
          {formatTimeRange(nowProgram.startTs, nowProgram.stopTs)}
        </span>
      </div>

      {/* Barre de progression */}
      <div className="epg-banner__progress-bar">
        <div
          className="epg-banner__progress-fill"
          style={{ width: `${nowProgram.progress}%` }}
        />
      </div>

      {/* Description (tronquée à 3 lignes avec "...") */}
      {nowProgram.description && (
        <div className="epg-banner__desc">
          {nowProgram.description}
        </div>
      )}

      {/* Séparateur + Programme suivant */}
      {nextProgram && (
        <>
          <div className="epg-banner__separator" />
          <div className="epg-banner__next">
            <span className="epg-banner__next-label">{t('epg_next')}</span>
            <span className="epg-banner__next-title">{nextProgram.title}</span>
            <span className="epg-banner__next-time">
              {formatTimeRange(nextProgram.startTs, nextProgram.stopTs)}
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default EpgBanner;
