import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { relaunch } from '@tauri-apps/plugin-process';
import type { AppUpdaterState } from '../../hooks/useAppUpdater';
import { useBackHandler } from '../../hooks/useBackHandler';
import { isAndroid } from '../../utils/platform';
import { quietTextField } from '../../utils/spatialNavigation';
import NyxButton from './NyxButton';

/**
 * TV : fenêtre de mise à jour, à la télécommande.
 *
 * - À l'apparition, la sélection va sur « Mettre à jour » ; elle ne sort pas de la fenêtre (calque
 *   `modal`) ; « Plus tard » ou Retour la ferment et rendent la sélection à l'élément d'avant.
 * - Un seul bouton principal du début à la fin (mettre à jour, téléchargement, installer, réessayer) :
 *   un bouton qui disparaît sous la télécommande fait perdre la sélection. Pendant le téléchargement
 *   il reste sélectionnable (aria-disabled) et un appui ne fait rien.
 * - Pendant le téléchargement, « Plus tard » ou Retour cachent seulement la fenêtre (le téléchargement
 *   ne s'annule pas). Elle ne revient pas d'elle-même pour cette mise à jour : elle surgirait peut-être
 *   pendant une lecture, dont les touches passent avant elle. Android ouvre son installateur à la fin
 *   du téléchargement ; une erreur ou un nouvel essai se suivent dans Paramètres › À propos.
 * - Fermée par « Plus tard », la mise à jour reste installable depuis Paramètres › À propos.
 *
 * Le calque est posé sur le cadre, pas sur le bandeau qui apparaît en fondu : un calque encore
 * transparent est ignoré par la navigation, les flèches partaient alors sur la page derrière.
 */
/**
 * Fenêtre cachée pendant le téléchargement en cours. Hors du composant : App le monte dans un arbre
 * différent selon l'écran (connexion, profils, accueil), un état local serait perdu au changement
 * d'écran et la fenêtre reviendrait. Oublié à la prochaine proposition (« disponible »).
 */
let hiddenDuringUpdate = false;

const TvUpdateDialog: React.FC<{ updater: AppUpdaterState }> = ({ updater }) => {
    const { t } = useTranslation('common');
    const { status, version, progress, error, androidError, apkUrl, needsInstallPermission, installUpdate, dismiss } = updater;
    const android = isAndroid();

    // Cachée pendant le téléchargement : jusqu'à la fin de cette mise à jour (le composant est retiré au
    // retour à « rien à proposer », une nouvelle proposition repart fenêtre ouverte)
    const [hidden, setHidden] = useState(() => hiddenDuringUpdate && status !== 'available');
    useEffect(() => {
        if (status === 'available') hiddenDuringUpdate = false;
    }, [status]);
    const open = (status === 'available' || status === 'downloading' || status === 'ready' || status === 'error')
        && !hidden;

    const downloading = status === 'downloading';
    // Erreur sans adresse d'APK (vérification manuelle, mise à jour du bureau) : rien à réessayer ici
    const hasPrimary = status !== 'error' || (android && apkUrl !== null);

    const close = () => {
        if (downloading) {
            hiddenDuringUpdate = true;
            setHidden(true);
        }
        else dismiss();
    };
    useBackHandler(open, close);

    const frameRef = useRef<HTMLDivElement>(null);

    // Sélection posée sur le bouton principal à l'apparition, rendue à l'élément d'avant à la fermeture
    useEffect(() => {
        if (!open) return;
        const opener = document.activeElement;
        return () => {
            if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
                quietTextField(opener); // champ de l'écran de connexion : sélectionné sans ouvrir le clavier
                opener.focus({ preventScroll: true });
            }
        };
    }, [open]);

    // Pas de sélection dans la fenêtre (apparition, bouton principal retiré après une erreur) : on la pose
    useEffect(() => {
        if (!open || frameRef.current?.contains(document.activeElement)) return;
        // Premier bouton du cadre : « Mettre à jour » s'il est là, sinon « Plus tard »
        frameRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    }, [open, hasPrimary]);

    if (!open) return null;

    const onPrimary = () => {
        if (downloading) return;
        if (status === 'ready' && !android) void relaunch();
        else void installUpdate();
    };

    const primaryLabel = (() => {
        switch (status) {
            case 'available': return t('update_download');
            case 'downloading': return `${t('update_downloading')} ${t('update_progress', { percent: Math.round(progress) })}`;
            case 'ready': return android ? t('update_android_install') : t('update_restart');
            default: return t('update_android_retry');
        }
    })();

    const title = (() => {
        switch (status) {
            case 'available': return t('update_available');
            case 'downloading': return t('update_downloading');
            case 'ready': return android ? t('update_android_ready') : t('update_ready');
            default: return t('update_error');
        }
    })();

    const errorDetail = status === 'error' ? (android && androidError ? t(`update_android_error_${androidError}`) : error) : null;

    return (
        <div className="update-notification" role="dialog" aria-modal="true" aria-label={title} data-testid="update-tv-dialog">
            <div className="update-notification__content" data-nav-layer="modal" ref={frameRef}>
                <div className="update-notification__info">
                    <div className="update-notification__text">
                        <strong>{title}</strong>
                        {version && status !== 'error' && (
                            <span className="update-notification__version">{t('update_version', { version })}</span>
                        )}
                        {needsInstallPermission && (status === 'available' || status === 'ready') && (
                            <span className="update-notification__version" data-testid="update-permission-hint">
                                {t('update_android_permission')}
                            </span>
                        )}
                        {errorDetail && <span className="update-notification__error-detail">{errorDetail}</span>}
                    </div>
                </div>
                {downloading && (
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
                )}
                <div className="update-notification__actions">
                    {hasPrimary && (
                        <NyxButton
                            variant="primary"
                            size="sm"
                            color="blue"
                            data-testid="update-tv-primary"
                            aria-disabled={downloading}
                            onClick={onPrimary}
                        >
                            {primaryLabel}
                        </NyxButton>
                    )}
                    <NyxButton
                        variant="secondary"
                        size="sm"
                        color="blue"
                        data-testid="update-later"
                        onClick={close}
                    >
                        {t('update_later')}
                    </NyxButton>
                </div>
            </div>
        </div>
    );
};

export default TvUpdateDialog;
