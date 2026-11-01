/**
 * Avertissement « base de l'appareil abîmée », avec « Réinitialiser cet appareil » (confirmé d'abord).
 *
 * Affiché sur chaque écran où le démarrage peut s'arrêter : le choix du profil (session enregistrée),
 * l'erreur de chargement des profils (sans réseau) et l'ajout du fournisseur. Avant, il n'existait que sur ce dernier : avec une session enregistrée,
 * l'utilisateur restait sur les profils sans explication. Rien n'est rendu tant que
 * le contrôle de la base (`checkLocalDatabase`) ne l'a pas trouvée abîmée.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import NyxButton from './NyxButton';
import ConfirmModal from './ConfirmModal';
import { useLocalDatabaseDamaged } from '../../services/localDatabaseHealth';
import { createLogger } from '../../utils/logger';

const log = createLogger('LocalDatabase');

interface LocalDatabaseDamagedNoticeProps {
  /**
   * Repère de l'écran (composant partagé) : le bandeau porte
   * `<repère>-damaged`, son bouton `<repère>-reset`, la fenêtre de confirmation `<repère>-reset-modal`
   */
  testId: string;
  /** Classe ajoutée au bandeau (largeur propre à l'écran) */
  className?: string;
  /** Rangée de la navigation à la télécommande, posée sur le bandeau (rien n'est rendu sinon) */
  navRow?: string;
}

const LocalDatabaseDamagedNotice: React.FC<LocalDatabaseDamagedNoticeProps> = ({ testId, className, navRow }) => {
  // Clés écrites avec leur espace (« common: »), comme sur l'écran du fournisseur
  const { t } = useTranslation(['common']);
  const damaged = useLocalDatabaseDamaged();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!damaged) return null;

  const handleReset = async (): Promise<void> => {
    setConfirmOpen(false);
    setFailed(false);
    setResetting(true);
    try {
      // Réinitialisation de cet appareil seulement, puis relance de l'app : le compte Nyx garde le reste
      const { performFullReset } = await import('../../services/fullResetService');
      await performFullReset();
    } catch (err) {
      log.error('Réinitialisation impossible :', err);
      setFailed(true);
      setResetting(false);
    }
  };

  return (
    <>
      <div
        className={className ? `login-error local-db-notice ${className}` : 'login-error local-db-notice'}
        data-testid={`${testId}-damaged`}
        data-nav-row={navRow}
        role="alert"
      >
        {/* Même disposition que l'ancien bandeau de l'écran du fournisseur : texte puis bouton côte à côte.
            Téléphone : le bouton passe sous le texte, sur toute la largeur (mobile.css), sinon il écrasait
            le texte en une colonne étroite aux mots coupés */}
        <p className="local-db-notice__text">
          {t('common:local_db_damaged_message')}
          {failed && <> <strong>{t('common:local_db_reset_failed')}</strong></>}
        </p>
        <NyxButton
          type="button"
          variant="secondary"
          size="sm"
          color="red"
          className="local-db-notice__reset"
          data-testid={`${testId}-reset`}
          onClick={() => setConfirmOpen(true)}
          disabled={resetting}
        >
          {t('common:local_db_reset_button')}
        </NyxButton>
      </div>
      {/* Sous <body> : le bandeau est dans une carte à backdrop-filter (écran du fournisseur), qui
          caserait la fenêtre dans la carte au lieu de l'écran */}
      {createPortal(<ConfirmModal
        testId={`${testId}-reset-modal`}
        isOpen={confirmOpen}
        title={t('common:local_db_reset_title')}
        message={t('common:local_db_reset_confirm')}
        confirmText={t('common:local_db_reset_button')}
        cancelText={t('common:provider_change_cancel')}
        danger
        onConfirm={() => void handleReset()}
        onCancel={() => setConfirmOpen(false)}
      />, document.body)}
    </>
  );
};

export default LocalDatabaseDamagedNotice;
