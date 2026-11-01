/**
 * SpeedMenu.tsx - Menu de sélection de vitesse de lecture
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { clickableProps } from '../../utils/clickable';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

interface SpeedMenuProps {
    isOpen: boolean;
    currentSpeed: number;
    menuRef: React.RefObject<HTMLDivElement>;
    onToggle: () => void;
    onSelectSpeed: (speed: number) => void;
}

const SpeedMenu: React.FC<SpeedMenuProps> = ({
    isOpen,
    currentSpeed,
    menuRef,
    onToggle,
    onSelectSpeed,
}) => {
    const { t } = useTranslation('player');
    return (
        <div className="player-speed-container" ref={menuRef}>
            <button
                className="player-btn player-speed-btn-text"
                onClick={onToggle}
                title={t('playback_speed')}
                data-testid="player-speed"
                data-value={currentSpeed}
            >
                {currentSpeed}x
            </button>
            {isOpen && (
                <div className="player-speed-menu" data-nav-layer="modal">
                    {SPEED_OPTIONS.map((speed) => (
                        <div
                            key={speed}
                            className={`speed-item ${currentSpeed === speed ? 'active' : ''}`}
                            data-testid="player-speed-option"
                            data-value={speed}
                            onClick={() => onSelectSpeed(speed)}
                            {...clickableProps(() => onSelectSpeed(speed))}
                        >
                            {speed}x
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SpeedMenu;
