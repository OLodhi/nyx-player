/**
 * Lecteur — boutons de gauche : lecture / pause, reculer et avancer de 10 s, épisode précédent
 * et suivant (séries).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  PlayIcon,
  PauseIcon,
  SkipBackwardIcon,
  SkipForwardIcon,
  PrevEpisodeIcon,
  NextEpisodeIcon,
} from '../PlayerIcons';

interface PlaybackButtonsProps {
  isPaused: boolean;
  onTogglePlayPause: () => void;
  onSkip: (seconds: number) => void;
  /** Absent : pas de bouton épisode précédent */
  onPrevEpisode?: () => void;
  /** Absent : pas de bouton épisode suivant */
  onNextEpisode?: () => void;
}

const PlaybackButtons: React.FC<PlaybackButtonsProps> = ({
  isPaused, onTogglePlayPause, onSkip, onPrevEpisode, onNextEpisode,
}) => {
  const { t } = useTranslation('player');
  return (
    <>
      <button className="player-btn" onClick={onTogglePlayPause} data-testid="player-play-pause" data-paused={isPaused}>
        {isPaused ? <PlayIcon /> : <PauseIcon />}
      </button>

      <button className="player-btn" onClick={() => onSkip(-10)} title={t('rewind_10s')} data-testid="player-rewind">
        <SkipBackwardIcon />
      </button>

      <button className="player-btn" onClick={() => onSkip(10)} title={t('forward_10s')} data-testid="player-forward">
        <SkipForwardIcon />
      </button>

      {onPrevEpisode && (
        <button className="player-btn episode-nav-btn" onClick={onPrevEpisode} title={t('prev_episode')} data-testid="player-prev-episode">
          <PrevEpisodeIcon />
        </button>
      )}

      {onNextEpisode && (
        <button className="player-btn episode-nav-btn" onClick={onNextEpisode} title={t('next_episode')} data-testid="player-next-episode">
          <NextEpisodeIcon />
        </button>
      )}
    </>
  );
};

export default PlaybackButtons;
