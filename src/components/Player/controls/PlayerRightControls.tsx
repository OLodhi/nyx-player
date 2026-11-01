/**
 * Lecteur — boutons de droite : vitesse, pistes audio et sous-titres, statistiques (si activées
 * dans les Réglages), format de l'image (ajusté / rempli / étiré), plein écran.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  FullscreenIcon,
  ExitFullscreenIcon,
  StatsIcon,
  FitScreenIcon,
  FillScreenIcon,
  StretchScreenIcon,
} from '../PlayerIcons';
import SpeedMenu from '../SpeedMenu';
import AudioSubMenu from '../AudioSubMenu';
import { isGeekStatsEnabled } from '../../../services/preferencesService';
import type { PlayerMenus } from '../../../hooks/usePlayerMenus';
import type { usePlayerPreferences } from '../../../hooks/usePlayerPreferences';
import type { AspectMode } from '../../../hooks/usePlayerActions';

type PlayerPrefs = ReturnType<typeof usePlayerPreferences>;

interface PlayerRightControlsProps {
  menus: PlayerMenus;
  prefs: Pick<PlayerPrefs, 'changeSpeed' | 'audioTracks' | 'subTracks' | 'subtitleScale' | 'selectAudioTrack' | 'selectSubTrack' | 'changeSubtitleScale'>;
  playbackSpeed: number;
  currentAudioId: number;
  currentSubId: number;
  aspectMode: AspectMode;
  onToggleAspect: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

const PlayerRightControls: React.FC<PlayerRightControlsProps> = ({
  menus, prefs, playbackSpeed, currentAudioId, currentSubId,
  aspectMode, onToggleAspect, isFullscreen, onToggleFullscreen,
}) => {
  const { t } = useTranslation('player');
  const {
    showSpeedMenu, setShowSpeedMenu, showAudioSubMenu, setShowAudioSubMenu,
    showGeekStats, setShowGeekStats, speedMenuRef, audioSubMenuRef,
  } = menus;

  return (
    <div className="player-controls-right">
      <SpeedMenu
        isOpen={showSpeedMenu}
        currentSpeed={playbackSpeed}
        menuRef={speedMenuRef as React.RefObject<HTMLDivElement>}
        onToggle={() => setShowSpeedMenu(!showSpeedMenu)}
        onSelectSpeed={(speed) => {
          void prefs.changeSpeed(speed);
          setShowSpeedMenu(false);
        }}
      />

      <AudioSubMenu
        isOpen={showAudioSubMenu}
        menuRef={audioSubMenuRef as React.RefObject<HTMLDivElement>}
        audioTracks={prefs.audioTracks}
        subTracks={prefs.subTracks}
        currentAudioId={currentAudioId}
        currentSubId={currentSubId}
        subtitleScale={prefs.subtitleScale}
        onToggle={() => setShowAudioSubMenu(!showAudioSubMenu)}
        onSelectAudioTrack={(trackId) => void prefs.selectAudioTrack(trackId)}
        onSelectSubTrack={(trackId) => void prefs.selectSubTrack(trackId)}
        onChangeSubtitleScale={(scale) => void prefs.changeSubtitleScale(scale)}
      />

      {/* Geek Stats Button */}
      {isGeekStatsEnabled() && (
        <button
          className={`player-btn geek-stats-btn ${showGeekStats ? 'active' : ''}`}
          onClick={() => setShowGeekStats(!showGeekStats)}
          data-testid="player-stats"
          title={t('geek_stats')}
        >
          <StatsIcon />
        </button>
      )}

      {/* Aspect Ratio Toggle (Fit / Fill / Stretch) */}
      <button className="player-btn" onClick={onToggleAspect} data-testid="player-aspect" title={
        aspectMode === 'fit' ? t('aspect_fit') :
        aspectMode === 'fill' ? t('aspect_fill') : t('aspect_stretch')
      }>
        {aspectMode === 'fit' ? <FitScreenIcon /> :
         aspectMode === 'fill' ? <FillScreenIcon /> : <StretchScreenIcon />}
      </button>

      {/* Fullscreen */}
      <button className="player-btn" onClick={onToggleFullscreen} data-testid="player-fullscreen">
        {isFullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
      </button>
    </div>
  );
};

export default PlayerRightControls;
