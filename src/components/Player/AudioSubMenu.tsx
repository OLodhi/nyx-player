/**
 * AudioSubMenu.tsx - Menu audio et sous-titres
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { AudioSubIcon, CheckIcon } from './PlayerIcons';
import { clickableProps } from '../../utils/clickable';
import type { Track } from '../../types/player';

export type { Track };

interface AudioSubMenuProps {
    isOpen: boolean;
    menuRef: React.RefObject<HTMLDivElement>;
    audioTracks: Track[];
    subTracks: Track[];
    currentAudioId: number;
    currentSubId: number;
    subtitleScale: number;
    onToggle: () => void;
    onSelectAudioTrack: (trackId: number) => void;
    onSelectSubTrack: (trackId: number) => void;
    onChangeSubtitleScale: (scale: number) => void;
}

const AudioSubMenu: React.FC<AudioSubMenuProps> = ({
    isOpen,
    menuRef,
    audioTracks,
    subTracks,
    currentAudioId,
    currentSubId,
    subtitleScale,
    onToggle,
    onSelectAudioTrack,
    onSelectSubTrack,
    onChangeSubtitleScale,
}) => {
    const { t } = useTranslation('player');

    return (
        <div className="player-audio-sub-container" ref={menuRef}>
            <button className="player-btn" onClick={onToggle} title={t('audio_subs_menu')} data-testid="player-audio-sub">
                <AudioSubIcon />
            </button>
            {isOpen && (
                <div className="player-audio-sub-popup" data-nav-layer="modal" data-testid="player-audio-sub-menu">
                    <div className="popup-content-row">
                        {/* Audio Column */}
                        <div className="popup-column">
                            <div className="popup-header">{t('header_audio', { count: audioTracks.length })}</div>
                            <div className="popup-list">
                                {audioTracks.length > 0 ? (
                                    audioTracks.map((track) => (
                                        <div
                                            key={track.id}
                                            className={`popup-item ${currentAudioId === track.id ? 'active' : ''}`}
                                            data-testid="player-audio-track"
                                            onClick={() => onSelectAudioTrack(track.id)}
                                            {...clickableProps(() => onSelectAudioTrack(track.id))}
                                        >
                                            {currentAudioId === track.id && <CheckIcon />}
                                            <span className="track-name">
                                                {track.title || track.lang || t('track_default', { id: track.id })}
                                            </span>
                                        </div>
                                    ))
                                ) : (
                                    <div className="popup-item disabled">{t('no_track')}</div>
                                )}
                            </div>
                        </div>

                        {/* Subtitles Column */}
                        <div className="popup-column">
                            <div className="popup-header">{t('header_subs', { count: subTracks.length })}</div>
                            <div className="popup-list">
                                <div
                                    className={`popup-item ${currentSubId === 0 ? 'active' : ''}`}
                                    data-testid="player-sub-off"
                                    onClick={() => onSelectSubTrack(0)}
                                    {...clickableProps(() => onSelectSubTrack(0))}
                                >
                                    {currentSubId === 0 && <CheckIcon />}
                                    <span className="track-name">{t('disabled')}</span>
                                </div>
                                {subTracks.map((track) => (
                                    <div
                                        key={track.id}
                                        className={`popup-item ${currentSubId === track.id ? 'active' : ''}`}
                                        data-testid="player-sub-track"
                                        onClick={() => onSelectSubTrack(track.id)}
                                        {...clickableProps(() => onSelectSubTrack(track.id))}
                                    >
                                        {currentSubId === track.id && <CheckIcon />}
                                        <span className="track-name">
                                            {track.title || track.lang || t('track_default', { id: track.id })}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Footer - Subtitle Scale */}
                    <div className="popup-footer">
                        <div className="footer-label">{t('text_size')}</div>
                        <div className="scale-slider-container">
                            <input
                                type="range"
                                min="0.5"
                                max="2"
                                step="0.25"
                                value={subtitleScale}
                                onChange={(e) => onChangeSubtitleScale(parseFloat(e.target.value))}
                                className="scale-slider"
                                data-testid="player-subtitle-size"
                            />
                            <div className="scale-value">
                                {subtitleScale === 1 ? t('scale_normal') : `${subtitleScale}x`}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AudioSubMenu;
