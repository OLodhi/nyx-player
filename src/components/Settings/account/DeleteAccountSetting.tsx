/**
 * Écran Compte — zone de danger : suppression du compte (mot de passe vérifié, marque posée avant
 * l'appel au serveur pour finir le nettoyage au lancement suivant si l'app se ferme).
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../services/supabaseClient';
import { useSupabaseAuth } from '../../../contexts/SupabaseAuthContext';
import { performFullReset } from '../../../services/fullResetService';
import { markAccountDeletionPending, clearAccountDeletionPending, confirmAccountDeletion } from '../../../services/accountDeletion';
import { useDevOverrides } from '../../../contexts/DevOverrideContext';
import NyxButton from '../../Common/NyxButton';
import PasswordInput from './PasswordInput';
import { isCurrentPasswordValid, authErrorMessageKey } from './accountChecks';

const DeleteAccountSetting: React.FC = () => {
  const { t } = useTranslation('settings');
  const { t: tAuth } = useTranslation('auth');
  const { user } = useSupabaseAuth();
  // Dépendances du useCallback ci-dessous : des valeurs simples, pas `user` entier
  const userEmail = user?.email;
  const userId = user?.id;
  const sp = useDevOverrides().overrides.settingsPage;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showDeletePwd, setShowDeletePwd] = useState(false);

  // ---- DevPanel effective states ----
  const effectiveShowDeleteConfirm = sp.forceDeleteConfirm || showDeleteConfirm;
  const effectiveDeleteLoading = sp.forceAccountLoading === 'delete' || deleteLoading;
  const effectiveDeleteError = sp.forceAccountError === 'delete' ? 'Simulated delete error' : deleteError;

  const handleDeleteAccount = useCallback(async () => {
    setDeleteError(null);

    if (!deletePassword) {
      setDeleteError(t('account_current_password_required'));
      return;
    }

    setDeleteLoading(true);
    try {
      let passwordValid: boolean;
      try {
        passwordValid = await isCurrentPasswordValid(userEmail, deletePassword);
      } catch (err) {
        // Hors ligne, trop d'essais : la vraie raison, plus « mot de passe actuel incorrect »
        setDeleteError(tAuth(authErrorMessageKey(err)));
        setDeleteLoading(false);
        return;
      }
      if (!passwordValid) {
        setDeleteError(t('account_current_password_wrong'));
        setDeleteLoading(false);
        return;
      }

      // Noté avant l'appel : app fermée avant la réponse → nettoyage local fini au lancement
      markAccountDeletionPending(userId);

      // Call Edge Function via Supabase client (handles apikey + JWT headers)
      const { error: fnError } = await supabase.functions.invoke('delete-account', {
        method: 'POST',
      });

      if (fnError) {
        // Réponse perdue (réseau coupé) : le serveur a pu supprimer le compte, la marque reste et le
        // lancement suivant finit le nettoyage. Refus explicite du serveur : rien à finir.
        if (fnError.name !== 'FunctionsFetchError') clearAccountDeletionPending();
        // Réponse perdue : le compte est peut-être déjà supprimé, le message ne pousse pas à recommencer
        setDeleteError(fnError.name === 'FunctionsFetchError' ? t('account_delete_unconfirmed') : t('account_delete_error'));
        setDeleteLoading(false);
        return;
      }

      // Compte supprimé par le serveur : une app fermée pendant le nettoyage le reprend au lancement
      // en visant la base et les identifiants de ce compte (accountDeletion.ts)
      confirmAccountDeletion();

      // Nettoyage complet local (DB, Keychain, caches, localStorage) puis relance (appRestart.ts :
      // nouveau processus sur ordinateur, page rechargée sur Android). Pas de signOut() : la session
      // Supabase est effacée, la relance ouvre l'écran de connexion
      await performFullReset({ deleteAccount: true });
    } catch {
      // Erreur affichée : l'utilisateur garde la main (réessayer), pas de nettoyage surprise au lancement
      clearAccountDeletionPending();
      setDeleteError(t('account_delete_error'));
    } finally {
      setDeleteLoading(false);
    }
  }, [deletePassword, userEmail, userId, t, tAuth]);

  const cancelDeleteForm = () => {
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError(null);
    setShowDeletePwd(false);
  };

  return (
    <>
      <div className="setting-item">
        <div className="setting-item__info">
          <span className="setting-item__label setting-item__label--danger">{t('account_delete_account')}</span>
        </div>
        {!effectiveShowDeleteConfirm && (
          <NyxButton
            variant="primary"
            size="sm"
            color="red"
            onClick={() => setShowDeleteConfirm(true)}
            data-testid="settings-account-delete"
          >
            {t('account_delete_btn')}
          </NyxButton>
        )}
      </div>

      {effectiveShowDeleteConfirm && (
        <div className="setting-item setting-item--form">
          <div className="settings-danger-warning">
            {t('account_delete_warning')}
          </div>
          <PasswordInput
            placeholder={t('account_current_password')}
            value={deletePassword}
            onChange={setDeletePassword}
            autoComplete="current-password"
            visible={showDeletePwd}
            onToggleVisible={() => setShowDeletePwd((v) => !v)}
          />
          {effectiveDeleteError && <div className="settings-inline-error">{effectiveDeleteError}</div>}
          <div className="settings-form-actions">
            <NyxButton
              variant="primary"
              size="xs"
              color="red"
              onClick={() => void handleDeleteAccount()}
              data-testid="settings-account-delete-confirm"
              disabled={effectiveDeleteLoading}
            >
              {effectiveDeleteLoading ? '…' : t('account_delete_confirm')}
            </NyxButton>
            <NyxButton
              data-testid="settings-account-delete-cancel"
              variant="secondary"
              size="xs"
              color="blue"
              onClick={cancelDeleteForm}
            >
              {t('cancel')}
            </NyxButton>
          </div>
        </div>
      )}
    </>
  );
};

export default DeleteAccountSetting;
