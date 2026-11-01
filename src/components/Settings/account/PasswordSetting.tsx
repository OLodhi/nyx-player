/**
 * Écran Compte — mot de passe : formulaire de changement (mot de passe actuel vérifié avant la
 * modification).
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../services/supabaseClient';
import { useSupabaseAuth } from '../../../contexts/SupabaseAuthContext';
import { useDevOverrides } from '../../../contexts/DevOverrideContext';
import NyxButton from '../../Common/NyxButton';
import PasswordInput from './PasswordInput';
import { passwordChangeError, isCurrentPasswordValid, authErrorMessageKey } from './accountChecks';

const PasswordSetting: React.FC = () => {
  const { t } = useTranslation('settings');
  const { t: tAuth } = useTranslation('auth');
  const { user } = useSupabaseAuth();
  // Dépendances du useCallback ci-dessous : des valeurs simples, pas `user` entier
  const userEmail = user?.email;
  const sp = useDevOverrides().overrides.settingsPage;

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);

  // ---- DevPanel effective states ----
  const effectiveShowPasswordForm = sp.forcePasswordForm || showPasswordForm;
  const effectivePasswordLoading = sp.forceAccountLoading === 'password' || passwordLoading;
  const effectivePasswordError = sp.forceAccountError === 'password' ? 'Simulated password error' : passwordError;
  const effectivePasswordSuccess = sp.forceAccountSuccess === 'password' ? 'Password updated!' : passwordSuccess;

  const handleChangePassword = useCallback(async () => {
    setPasswordError(null);
    setPasswordSuccess(null);

    const inputError = passwordChangeError(currentPassword, newPassword, confirmPassword);
    if (inputError) {
      setPasswordError(t(inputError));
      return;
    }

    setPasswordLoading(true);
    try {
      if (!(await isCurrentPasswordValid(userEmail, currentPassword))) {
        setPasswordError(t('account_current_password_wrong'));
        setPasswordLoading(false);
        return;
      }

      // Mot de passe actuel aussi envoyé au serveur : il le vérifie lui-même une fois le
      // réglage « mot de passe actuel requis » activé côté Supabase ; ignoré tant qu'il ne l'est pas.
      const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword });
      if (error) {
        setPasswordError(tAuth(authErrorMessageKey(error)));
      } else {
        setPasswordSuccess(t('account_password_updated'));
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordForm(false);
      }
    } catch (err) {
      // Hors ligne, trop d'essais : la vraie raison, plus « mot de passe actuel incorrect »
      setPasswordError(tAuth(authErrorMessageKey(err)));
    } finally {
      setPasswordLoading(false);
    }
  }, [currentPassword, newPassword, confirmPassword, userEmail, t, tAuth]);

  const cancelPasswordForm = () => {
    setShowPasswordForm(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setShowCurrentPwd(false);
    setShowNewPwd(false);
    setShowConfirmPwd(false);
  };

  return (
    <>
      <div className="setting-item">
        <div className="setting-item__info">
          <span className="setting-item__label">{t('account_password_label')}</span>
          <span className="setting-item__desc">{t('account_password_desc')}</span>
        </div>
        {!effectiveShowPasswordForm && (
          <NyxButton
            data-testid="settings-password-change"
            variant="primary"
            size="sm"
            color="blue"
            onClick={() => { setShowPasswordForm(true); setPasswordSuccess(null); }}
          >
            {t('account_change')}
          </NyxButton>
        )}
      </div>

      {effectiveShowPasswordForm && (
        <div className="setting-item setting-item--form">
          <PasswordInput
            placeholder={t('account_current_password')}
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            visible={showCurrentPwd}
            onToggleVisible={() => setShowCurrentPwd((v) => !v)}
          />
          <PasswordInput
            placeholder={t('account_new_password')}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            visible={showNewPwd}
            onToggleVisible={() => setShowNewPwd((v) => !v)}
          />
          <PasswordInput
            placeholder={t('account_confirm_new_password')}
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            visible={showConfirmPwd}
            onToggleVisible={() => setShowConfirmPwd((v) => !v)}
          />
          {effectivePasswordError && <div className="settings-inline-error">{effectivePasswordError}</div>}
          <div className="settings-form-actions">
            <NyxButton
              data-testid="settings-password-save"
              variant="primary"
              size="xs"
              color="blue"
              onClick={() => void handleChangePassword()}
              disabled={effectivePasswordLoading}
            >
              {effectivePasswordLoading ? '…' : t('account_confirm')}
            </NyxButton>
            <NyxButton
              data-testid="settings-password-cancel"
              variant="primary"
              size="xs"
              color="red"
              onClick={cancelPasswordForm}
            >
              {t('cancel')}
            </NyxButton>
          </div>
        </div>
      )}
      {effectivePasswordSuccess && <div className="settings-inline-success">{effectivePasswordSuccess}</div>}
    </>
  );
};

export default PasswordSetting;
