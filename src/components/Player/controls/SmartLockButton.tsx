/**
 * Lecteur — cadenas (verrouillage des contrôles), toujours au même endroit de l'écran.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { LockIcon, UnlockIcon } from '../PlayerIcons';

interface SmartLockButtonProps {
  isLocked: boolean;
  /** Cadenas affiché (contrôles visibles, ou toucher récent quand verrouillé) */
  isVisible: boolean;
  onLock: () => void;
  onUnlock: () => void;
}

const SmartLockButton: React.FC<SmartLockButtonProps> = ({ isLocked, isVisible, onLock, onUnlock }) => {
  const { t } = useTranslation('player');
  return (
    <div className={`player-smart-lock-fixed ${isVisible ? 'visible' : 'hidden'}`}>
      <button
        className={`player-lock-btn-fixed ${isLocked ? 'locked' : 'unlocked'}`}
        data-testid="player-lock"
        onClick={(e) => {
          if (isLocked) {
            onUnlock();
          } else {
            onLock();
          }
          (e.currentTarget as HTMLButtonElement).blur();
        }}
        title={isLocked ? t('unlock') : t('lock')}
      >
        {isLocked ? <LockIcon /> : <UnlockIcon />}
      </button>
    </div>
  );
};

export default SmartLockButton;
