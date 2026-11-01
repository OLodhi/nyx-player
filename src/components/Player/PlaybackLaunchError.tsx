/**
 * PlaybackLaunchError — Lecture qui n'a pas pu démarrer, alors qu'aucun lecteur n'est ouvert.
 *
 * L'écran d'erreur du lecteur (PlaybackErrorOverlay) vit dans PlayerControls, monté seulement
 * pendant une lecture. Quand le lancement échoue avant (identifiants introuvables, adresse du flux
 * impossible à construire, moteur qui refuse le chargement), « Lecture » ne faisait rien, sans
 * message. Même fenêtre que les confirmations : focus et Retour gérés à la télécommande.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmModal from '../Common/ConfirmModal';
import { usePlayer } from '../../contexts/PlayerContext';

const PlaybackLaunchError: React.FC = () => {
  const { t } = useTranslation('player');
  const { playbackError, currentlyPlaying, isTransitioningToPlayer, retryPlayback, cancelFailedLaunch } = usePlayer();

  const isOpen = !!playbackError && !currentlyPlaying && !isTransitioningToPlayer;
  const kind = playbackError?.kind ?? 'unknown';

  return (
    <ConfirmModal
      testId="playback-launch-error-modal"
      isOpen={isOpen}
      title={t(`error_${kind}_title`)}
      message={t(`error_${kind}_body`, { detail: playbackError?.detail || t('error_format_unknown') })}
      confirmText={t('error_retry_now')}
      cancelText={t('error_close')}
      danger={false}
      onConfirm={() => { void retryPlayback(); }}
      onCancel={cancelFailedLaunch}
    />
  );
};

export default PlaybackLaunchError;
