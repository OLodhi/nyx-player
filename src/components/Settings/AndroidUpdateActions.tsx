import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AppUpdaterState } from '../../hooks/useAppUpdater';
import NyxButton from '../Common/NyxButton';

/**
 * Paramètres › À propos, Android (téléphone et TV) : installer la mise à jour trouvée.
 * C'est le recours après « Plus tard » dans le bandeau (téléphone) ou la fenêtre (TV) : « Vérifier les
 * mises à jour » la propose de nouveau.
 *
 * Un seul bouton, qui reste du début à la fin (installer, téléchargement, installer, réessayer) :
 * un bouton qui disparaît sous la télécommande fait perdre le focus, renvoyé loin d'À propos. Pendant
 * le téléchargement il reste focusable (aria-disabled, pas disabled) et un appui ne fait rien.
 */
const AndroidUpdateActions: React.FC<{ updater: AppUpdaterState }> = ({ updater }) => {
    const { t } = useTranslation('common');
    const { status, version, progress, androidError, apkUrl, needsInstallPermission, installUpdate } = updater;

    const hasApk = apkUrl !== null;
    const shown = status === 'available' || status === 'downloading' || status === 'ready' || (status === 'error' && androidError !== null);
    if (!shown) return null;

    const downloading = status === 'downloading';
    const label = (() => {
        switch (status) {
            case 'available': return t('update_android_install_version', { version });
            case 'downloading': return `${t('update_downloading')} ${t('update_progress', { percent: Math.round(progress) })}`;
            case 'ready': return t('update_android_install');
            default: return t('update_android_retry');
        }
    })();

    return (
        <>
            {(status !== 'error' || hasApk) && (
                <NyxButton
                    variant="primary"
                    size="sm"
                    color="blue"
                    data-testid="settings-update-install"
                    aria-disabled={downloading}
                    onClick={() => { if (!downloading) void installUpdate(); }}
                >
                    {label}
                </NyxButton>
            )}
            {needsInstallPermission && (status === 'available' || status === 'ready') && (
                <span className="about-update-check__result" data-testid="settings-update-permission">
                    {t('update_android_permission')}
                </span>
            )}
            {status === 'error' && androidError && (
                <span className="about-update-check__result" data-testid="settings-update-error">
                    {t(`update_android_error_${androidError}`)}
                </span>
            )}
            {status === 'error' && hasApk && (
                <span className="about-update-check__result">
                    {t('update_android_manual', { url: apkUrl })}
                </span>
            )}
        </>
    );
};

export default AndroidUpdateActions;
