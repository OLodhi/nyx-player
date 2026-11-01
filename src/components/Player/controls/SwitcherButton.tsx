/**
 * Lecteur — bouton central : liste des épisodes (séries) ou, à défaut, liste des chaînes (direct).
 * Ouvrir l'une ferme l'autre.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { TvIcon, EpisodesListIcon } from '../PlayerIcons';

interface SwitcherState {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

interface SwitcherButtonProps {
  /** Série en cours (ou mode série forcé) : bouton des épisodes */
  seriesMode: boolean;
  /** Direct : bouton des chaînes, quand ce n'est pas une série */
  isLive: boolean;
  episodeSwitcher: SwitcherState;
  channelSwitcher: SwitcherState;
}

const SwitcherButton: React.FC<SwitcherButtonProps> = ({ seriesMode, isLive, episodeSwitcher, channelSwitcher }) => {
  const { t } = useTranslation('player');

  if (seriesMode) {
    return (
      <button
        className={`player-btn episode-trigger-btn ${episodeSwitcher.isOpen ? 'active' : ''}`}
        data-testid="player-episodes"
        onClick={() => {
          if (channelSwitcher.isOpen) channelSwitcher.close();
          episodeSwitcher.toggle();
        }}
        title={t('episodes_list', 'Épisodes')}
      >
        <EpisodesListIcon />
        <span>{t('episodes_list', 'Épisodes')}</span>
      </button>
    );
  }

  if (isLive) {
    return (
      <button
        className={`player-btn episode-trigger-btn ${channelSwitcher.isOpen ? 'active' : ''}`}
        data-testid="player-channels"
        onClick={() => {
          if (episodeSwitcher.isOpen) episodeSwitcher.close();
          channelSwitcher.toggle();
        }}
        title={t('channel_list', 'Chaînes TV')}
      >
        <TvIcon />
        <span>{t('channel_list', 'Chaînes TV')}</span>
      </button>
    );
  }

  return null;
};

export default SwitcherButton;
