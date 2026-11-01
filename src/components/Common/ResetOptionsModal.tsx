/**
 * ResetOptionsModal - Modal avec checkboxes pour choisir quoi effacer
 */

import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import NyxButton from './NyxButton';
import { useBackHandler } from '../../hooks/useBackHandler';
import { isTv } from '../../utils/platform';
import './ConfirmModal.css';
import './ResetOptionsModal.css';

// Re-export for backward compatibility
export type { ResetOptions } from '../../types/common';
import type { ResetOptions } from '../../types/common';


interface ResetOptionsModalProps {
    isOpen: boolean;
    /** 'movies' ou 'series' */
    type: 'movies' | 'series';
    onConfirm: (options: ResetOptions) => void;
    onCancel: () => void;
}

const ResetOptionsModal: React.FC<ResetOptionsModalProps> = ({
    isOpen,
    type,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation('settings');
    const [options, setOptions] = useState<ResetOptions>({
        positions: false,
        cache: false,
    });

    // Reset checkboxes when modal opens
    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- cases remises à zéro à chaque ouverture ; ouverture par clic ou touche, appliquée avant l'affichage
            setOptions({ positions: false, cache: false });
        }
    }, [isOpen]);

    useBackHandler(isOpen, onCancel);

    // TV, comme ConfirmModal : la sélection part de « Annuler » et revient, à la fermeture, sur le
    // bouton qui a ouvert la fenêtre ; sans cela elle restait derrière la fenêtre, et Annuler était
    // inatteignable à la télécommande (banc de test)
    const actionsRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!isOpen || !isTv()) return;
        const opener = document.activeElement;
        actionsRef.current?.querySelector('button')?.focus({ preventScroll: true });
        return () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, [isOpen]);

    // Close on Escape key - MUST be before conditional return (Rules of Hooks)
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onCancel();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onCancel]);

    if (!isOpen) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    };

    const handleConfirm = () => {
        if (options.positions || options.cache) {
            onConfirm(options);
        }
    };

    const toggleOption = (key: keyof ResetOptions) => {
        setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const title = type === 'movies' ? t('reset_movies') : t('reset_series');
    const isDisabled = !options.positions && !options.cache;

    return (
        // Télécommande : la sélection reste dans la fenêtre (calque « modal »)
        <div className="confirm-modal-backdrop" onClick={handleBackdropClick} data-nav-layer="modal">
            <div className="confirm-modal reset-options-modal" data-testid="reset-options-modal">
                <div className="confirm-modal-header">
                    <span className="confirm-modal-icon">🗑️</span>
                    <h3 className="confirm-modal-title">{title}</h3>
                </div>

                <p className="confirm-modal-message">{t('reset_select_options')}</p>

                <div className="reset-options-list">
                    <label className="reset-option-item">
                        <input
                            type="checkbox"
                            checked={options.positions}
                            data-testid="reset-option-positions"
                            onChange={() => toggleOption('positions')}
                        />
                        <div className="reset-option-content">
                            <span className="reset-option-label">{t('reset_opt_positions')}</span>
                            <span className="reset-option-desc">{t('reset_opt_positions_desc')}</span>
                        </div>
                    </label>

                    <label className="reset-option-item">
                        <input
                            type="checkbox"
                            checked={options.cache}
                            data-testid="reset-option-cache"
                            onChange={() => toggleOption('cache')}
                        />
                        <div className="reset-option-content">
                            <span className="reset-option-label">{t('reset_opt_cache')}</span>
                            <span className="reset-option-desc">{t('reset_opt_cache_desc')}</span>
                        </div>
                    </label>
                </div>

                <p className="reset-warning">⚠️ {t('confirm_irreversible')}</p>

                <div className="confirm-modal-actions" ref={actionsRef}>
                    <NyxButton variant="primary" size="sm" color="blue-light" onClick={onCancel} data-testid="reset-options-cancel">
                        {t('modal_cancel')}
                    </NyxButton>
                    <NyxButton variant="primary" size="sm" color="red" onClick={handleConfirm} disabled={isDisabled} data-testid="reset-options-confirm">
                        {t('btn_reset')}
                    </NyxButton>
                </div>
            </div>
        </div>
    );
};

export default ResetOptionsModal;
