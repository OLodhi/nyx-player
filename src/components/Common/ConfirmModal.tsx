/**
 * ConfirmModal - Modal de confirmation avec double validation
 * 
 * Utilisé pour les actions destructives (reset, suppression)
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import NyxButton from './NyxButton';
import { useBackHandler } from '../../hooks/useBackHandler';
import { isTv } from '../../utils/platform';
import './ConfirmModal.css';

interface ConfirmModalProps {
    /** Modal visible */
    isOpen: boolean;
    /** Titre du modal */
    title: string;
    /** Message de confirmation */
    message: string;
    /** Texte bouton confirmer (défaut: "Confirmer") */
    confirmText?: string;
    /** Texte bouton annuler (défaut: "Annuler") */
    cancelText?: string;
    /** Style danger (rouge) pour le bouton confirmer */
    danger?: boolean;
    /** Checkbox optionnelle entre le message et les boutons */
    checkbox?: {
        label: string;
        checked: boolean;
        onChange: (checked: boolean) => void;
        /** Précision sous la case (ex. ce qui est effacé et ce qui est gardé), lue avec elle */
        hint?: string;
    };
    /** Action de plus, entre Annuler et Confirmer (ex. « Retirer » à côté de « Rechercher ») */
    extraAction?: {
        label: string;
        onClick: () => void;
        danger?: boolean;
    };
    /** Callback sur confirmation ; sans elle, pas de bouton Confirmer */
    onConfirm?: () => void;
    /** Callback sur annulation */
    onCancel: () => void;
    /** Repère du banc de test, propre à chaque fenêtre (défaut : « confirm-modal ») */
    testId?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    danger = true,
    checkbox,
    extraAction,
    onConfirm,
    onCancel,
    testId = 'confirm-modal',
}) => {
    const { t } = useTranslation('settings');

    const hintId = React.useId();

    useBackHandler(isOpen, onCancel);

    // TV : la sélection part de « Annuler », le choix sans risque ; à la fermeture, elle revient sur
    // l'élément qui a ouvert la fenêtre (interrupteur, bouton), sinon elle était perdue et la
    // télécommande repartait de nulle part (Chromecast)
    const actionsRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (!isOpen || !isTv()) return;
        const opener = document.activeElement;
        actionsRef.current?.querySelector('button')?.focus({ preventScroll: true });
        return () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, [isOpen]);

    // Close on Escape key - MUST be before conditional return (Rules of Hooks)
    React.useEffect(() => {
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

    // Close on backdrop click
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onCancel();
        }
    };

    return (
        // Télécommande : la sélection reste dans la fenêtre (elle partait derrière, Chromecast)
        <div className="confirm-modal-backdrop" onClick={handleBackdropClick} data-nav-layer="modal">
            <div className="confirm-modal" data-testid={testId}>
                <div className="confirm-modal-header">
                    <span className="confirm-modal-icon">⚠️</span>
                    <h3 className="confirm-modal-title">{title}</h3>
                </div>
                <p className="confirm-modal-message">{message}</p>
                {checkbox && (
                    <>
                        <label className={`confirm-modal-checkbox${checkbox.hint ? ' confirm-modal-checkbox--with-hint' : ''}`}>
                            <input
                                type="checkbox"
                                data-testid="confirm-modal-checkbox"
                                checked={checkbox.checked}
                                onChange={(e) => checkbox.onChange(e.target.checked)}
                                aria-describedby={checkbox.hint ? hintId : undefined}
                            />
                            <span>{checkbox.label}</span>
                        </label>
                        {checkbox.hint && (
                            <p id={hintId} className="confirm-modal-checkbox-hint">{checkbox.hint}</p>
                        )}
                    </>
                )}
                <div className="confirm-modal-actions" ref={actionsRef}>
                    <NyxButton variant="primary" size="sm" color="blue-light" onClick={onCancel} data-testid="confirm-modal-cancel">
                        {cancelText || t('modal_cancel')}
                    </NyxButton>
                    {extraAction && (
                        <NyxButton variant="primary" size="sm" color={extraAction.danger ? 'red' : 'blue'} onClick={extraAction.onClick} data-testid="confirm-modal-extra">
                            {extraAction.label}
                        </NyxButton>
                    )}
                    {onConfirm && (
                        <NyxButton variant="primary" size="sm" color={danger ? 'red' : 'blue'} onClick={onConfirm} data-testid="confirm-modal-confirm">
                            {confirmText || t('modal_confirm')}
                        </NyxButton>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
