/**
 * PlaybackErrorOverlay — Échec du flux expliqué à l'utilisateur, avec reconnexion espacée.
 *
 * Remplace le spinner infini quand le fournisseur refuse le flux (HTTP 458 = limite de
 * connexions, 403, 404…) ou quand le moteur ne sait pas décoder la vidéo.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PlaybackError } from '../../services/player/playbackErrors';
import { isAutoRetryable } from '../../services/player/playbackErrors';
import { usePlaybackRetry } from '../../hooks/usePlaybackRetry';
import './PlaybackErrorOverlay.css';

/** Même moteur mpv partout : libmpv (Android) et mpv.exe (desktop) */
const ENGINE_LABEL = 'MPV';

interface PlaybackErrorOverlayProps {
  error: PlaybackError;
  /** Relances déjà faites pour cette lecture (PlayerContext) */
  retryAttempt: number;
  onRetry: () => void | Promise<void>;
  onClose: () => void;
  /** Lecture qui continue derrière le message : le fermer sans arrêter */
  onContinue?: () => void;
}

const PlaybackErrorOverlay: React.FC<PlaybackErrorOverlayProps> = ({ error, retryAttempt, onRetry, onClose, onContinue }) => {
  const { t } = useTranslation('player');
  const retry = usePlaybackRetry(error, retryAttempt, onRetry);
  const autoRetryable = isAutoRetryable(error.kind);
  // Relancer un flux trop lourd pour l'appareil redonnerait la même saccade puis la même erreur
  const canRetry = error.kind !== 'device_too_slow';
  const canContinue = !!error.continuable && !!onContinue;
  // Moteur arrêté : plus d'image derrière la page transparente du lecteur, le fond doit tout couvrir
  const opaque = error.kind === 'engine_stopped';

  const body = t(`error_${error.kind}_body`, { detail: error.detail || t('error_format_unknown') });

  return (
    <div className={`playback-error${opaque ? ' playback-error--opaque' : ''}`} role="alertdialog" aria-live="assertive" data-testid="playback-error">
      <div className="playback-error__card">
        <h2 className="playback-error__title" data-testid="playback-error-title">{t(`error_${error.kind}_title`)}</h2>
        <p className="playback-error__body">{body}</p>
        {error.known && <p className="playback-error__body">{t('error_device_too_slow_known')}</p>}

        {autoRetryable && retry.secondsLeft !== null && (
          <p className="playback-error__countdown">
            {t('error_retry_countdown', {
              seconds: retry.secondsLeft,
              attempt: retry.attempt + 1,
              max: retry.maxAttempts,
            })}
          </p>
        )}
        {retry.exhausted && <p className="playback-error__countdown">{t('error_retry_exhausted')}</p>}

        <div className="playback-error__actions">
          {canRetry && (
            <button
              className="playback-error__button playback-error__button--primary"
              data-testid="playback-error-retry"
              onClick={retry.retryNow}
            >
              {t('error_retry_now')}
            </button>
          )}
          {autoRetryable && retry.secondsLeft !== null && (
            <button className="playback-error__button" onClick={retry.cancel} data-testid="playback-error-cancel-retry">
              {t('error_retry_cancel')}
            </button>
          )}
          <button
            className={`playback-error__button${canRetry ? '' : ' playback-error__button--primary'}`}
            onClick={onClose}
            data-testid="playback-error-close"
          >
            {t('error_close_player')}
          </button>
          {canContinue && (
            <button className="playback-error__button" onClick={onContinue} data-testid="playback-error-continue">
              {t('error_continue_anyway')}
            </button>
          )}
        </div>

        <p className="playback-error__meta">
          {[error.httpStatus ? `HTTP ${error.httpStatus}` : null, ENGINE_LABEL].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
};

export default PlaybackErrorOverlay;
