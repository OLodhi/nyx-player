/**
 * Lecteur — son : bouton muet et curseur de volume déplié au survol de la souris.
 */

import React from 'react';
import { VolumeHighIcon, VolumeLowIcon, VolumeMuteIcon } from '../PlayerIcons';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  sliderVisible: boolean;
  onSliderVisibleChange: (visible: boolean) => void;
  onToggleMute: () => void;
  onVolumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  tv: boolean;
}

const VolumeControl: React.FC<VolumeControlProps> = ({
  volume, isMuted, sliderVisible, onSliderVisibleChange, onToggleMute, onVolumeChange, tv,
}) => (
  <div
    className="player-volume-container"
    onMouseEnter={() => onSliderVisibleChange(true)}
    onMouseLeave={() => onSliderVisibleChange(false)}
  >
    <button className="player-btn" onClick={onToggleMute} data-testid="player-mute">
      {isMuted || volume === 0 ? (
        <VolumeMuteIcon />
      ) : volume < 50 ? (
        <VolumeLowIcon />
      ) : (
        <VolumeHighIcon />
      )}
    </button>
    <div className={`player-volume-slider ${sliderVisible ? 'visible' : ''}`}>
      <div className="volume-slider-track">
        <div
          className="volume-slider-fill"
          style={{ width: `${isMuted ? 0 : volume}%` }}
        />
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={onVolumeChange}
          className="volume-slider-input"
          data-testid="player-volume"
          // Replié à la souris seulement : invisible, il happait le focus de la télécommande
          tabIndex={tv ? -1 : undefined}
        />
      </div>
    </div>
  </div>
);

export default VolumeControl;
