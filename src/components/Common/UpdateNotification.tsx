import React from 'react';
import { useTranslation } from 'react-i18next';
import { relaunch } from '@tauri-apps/plugin-process';
import type { AppUpdaterState } from '../../hooks/useAppUpdater';
import { isAndroid, isTv } from '../../utils/platform';
import NyxButton from './NyxButton';
import TvUpdateDialog from './TvUpdateDialog';
import checkIcon from '../../assets/icons/check.svg';
import crossIcon from '../../assets/icons/cross.svg';
import './UpdateNotification.css';

// =============================================================================
// PROPS
// =============================================================================

interface UpdateNotificationProps {
    updater: AppUpdaterState;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Non-blocking update notification banner.
 * Renders at the bottom of the screen when an update is available.
 *
 * States:
 * - available: shows version + [Update] [Later] buttons
 * - downloading: shows progress bar
 * - ready: shows [Restart Now] button
 * - error: shows error message + [Retry]
 * - idle/checking: renders nothing
 */

const UpdateNotification: React.FC<UpdateNotificationProps> = ({ updater }) => {
    const { t } = useTranslation('common');
    const { status, version, progress, error, androidError, apkUrl, needsInstallPermission, installUpdate, dismiss } = updater;
    const android = isAndroid();

    // Don't render for idle or checking states
    if (status === 'idle' || status === 'checking') return null;

    // TV : fenêtre qui prend la sélection de la télécommande (« Mettre à jour », « Plus tard », Retour)
    if (isTv()) return <TvUpdateDialog updater={updater} />;

    // Ordinateur : le texte brut du module de mise à jour (anglais technique) n'est plus affiché ;
    // téléchargement coupé (mise à jour connue) ou vérification impossible, dit en clair
    const errorDetail = android
        ? (androidError ? t(`update_android_error_${androidError}`) : error)
        : (error ? t(version ? 'update_error_download' : 'update_error_check') : null);
    // « Réessayer » aussi sur ordinateur quand une mise à jour est connue (avant : « Plus tard » seul)
    const canRetry = android ? !!apkUrl : !!version;

    return (
        <div className="update-notification" role="alert" aria-live="polite">
            <div className="update-notification__content">

                {/* === AVAILABLE === */}
                {status === 'available' && (
                    <>
                        <div className="update-notification__info">
                            <svg className="update-notification__svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="16 12 12 8 8 12" /><line x1="12" y1="16" x2="12" y2="8" /></svg>
                            <div className="update-notification__text">
                                <strong>{t('update_available')}</strong>
                                <span className="update-notification__version">
                                    {t('update_version', { version })}
                                </span>
                                {android && needsInstallPermission && (
                                    <span className="update-notification__version" data-testid="update-permission-hint">
                                        {t('update_android_permission')}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="update-notification__actions">
                            <NyxButton
                                variant="primary"
                                size="sm"
                                color="blue"
                                data-testid="update-download"
                                onClick={() => void installUpdate()}
                            >
                                {t('update_download')}
                            </NyxButton>
                            <button
                                type="button"
                                className="update-notification__dismiss"
                                data-testid="update-later"
                                onClick={dismiss}
                            >
                                {t('update_later')}
                            </button>

                        </div>
                    </>
                )}

                {/* === DOWNLOADING === */}
                {status === 'downloading' && (
                    <>
                        <div className="update-notification__info">
                            <div className="update-notification__text">
                                <strong>{t('update_downloading')}</strong>
                                <span className="update-notification__version">
                                    {t('update_progress', { percent: Math.round(progress) })}
                                </span>
                            </div>
                        </div>
                        <div className="update-notification__progress">
                            <div
                                className="update-notification__progress-fill"
                                style={{ width: `${Math.min(progress, 100)}%` }}
                                role="progressbar"
                                aria-valuenow={Math.round(progress)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            />
                        </div>
                    </>
                )}

                {/* === READY === */}
                {status === 'ready' && (
                    <>
                        <div className="update-notification__info">
                            <img src={checkIcon} alt="" className="update-notification__svg-icon" />
                            <div className="update-notification__text">
                                <strong>{android ? t('update_android_ready') : t('update_ready')}</strong>
                                {android && needsInstallPermission && (
                                    <span className="update-notification__version" data-testid="update-permission-hint">
                                        {t('update_android_permission')}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="update-notification__actions">
                            {android ? (
                                <NyxButton
                                    variant="primary"
                                    size="sm"
                                    color="blue"
                                    data-testid="update-install"
                                    onClick={() => void installUpdate()}
                                >
                                    {t('update_android_install')}
                                </NyxButton>
                            ) : (
                                <NyxButton
                                    variant="primary"
                                    size="sm"
                                    color="blue"
                                    data-testid="update-restart"
                                    onClick={() => void relaunch()}
                                >
                                    {t('update_restart')}
                                </NyxButton>
                            )}
                            {android && (
                                <button
                                    type="button"
                                    className="update-notification__dismiss"
                                    data-testid="update-later"
                                    onClick={dismiss}
                                >
                                    {t('update_later')}
                                </button>
                            )}
                        </div>
                    </>
                )}

                {/* === ERROR === */}
                {status === 'error' && (
                    <>
                        <div className="update-notification__info">
                            <img src={crossIcon} alt="" className="update-notification__svg-icon update-notification__svg-icon--error" />
                            <div className="update-notification__text">
                                <strong>{t('update_error')}</strong>
                                {errorDetail && (
                                    <span className="update-notification__error-detail">
                                        {errorDetail}
                                    </span>
                                )}
                                {android && apkUrl && (
                                    <span className="update-notification__version" data-testid="update-apk-url">
                                        {t('update_android_manual', { url: apkUrl })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="update-notification__actions">
                            {canRetry && (
                                <NyxButton
                                    variant="primary"
                                    size="sm"
                                    color="blue"
                                    data-testid="update-retry"
                                    onClick={() => void installUpdate()}
                                >
                                    {t('update_android_retry')}
                                </NyxButton>
                            )}
                            <button
                                type="button"
                                className="update-notification__dismiss"
                                data-testid="update-later"
                                onClick={dismiss}
                            >
                                {t('update_later')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default UpdateNotification;
