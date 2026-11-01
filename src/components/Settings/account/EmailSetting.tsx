/**
 * Écran Compte — adresse email : affichage et formulaire de changement (mot de passe actuel
 * vérifié avant l'envoi du changement).
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../../services/supabaseClient';
import { useSupabaseAuth } from '../../../contexts/SupabaseAuthContext';
import { useDevOverrides } from '../../../contexts/DevOverrideContext';
import NyxButton from '../../Common/NyxButton';
import PasswordInput from './PasswordInput';
import { emailChangeError, isCurrentPasswordValid, authErrorMessageKey } from './accountChecks';

const EmailSetting: React.FC = () => {
  const { t } = useTranslation('settings');
  const { t: tAuth } = useTranslation('auth');
  const { user } = useSupabaseAuth();
  // Dépendances du useCallback ci-dessous : des valeurs simples, pas `user` entier
  const userEmail = user?.email;
  const sp = useDevOverrides().overrides.settingsPage;

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [showEmailPwd, setShowEmailPwd] = useState(false);

  // ---- DevPanel effective states ----
  const effectiveShowEmailForm = sp.forceEmailForm || showEmailForm;
  const effectiveEmailLoading = sp.forceAccountLoading === 'email' || emailLoading;
  const effectiveEmailError = sp.forceAccountError === 'email' ? 'Simulated email error' : emailError;
  const effectiveEmailSuccess = sp.forceAccountSuccess === 'email' ? 'Email change sent!' : emailSuccess;

  const handleChangeEmail = useCallback(async () => {
    setEmailError(null);
    setEmailSuccess(null);

    const inputError = emailChangeError(emailPassword, newEmail);
    if (inputError) {
      setEmailError(t(inputError));
      return;
    }

    setEmailLoading(true);
    try {
      if (!(await isCurrentPasswordValid(userEmail, emailPassword))) {
        setEmailError(t('account_current_password_wrong'));
        setEmailLoading(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) {
        setEmailError(tAuth(authErrorMessageKey(error)));
      } else {
        setEmailSuccess(t('account_email_change_sent'));
        setEmailPassword('');
        setNewEmail('');
        setShowEmailForm(false);
        setShowEmailPwd(false);
      }
    } catch (err) {
      // Hors ligne, trop d'essais : la vraie raison, plus « mot de passe actuel incorrect »
      setEmailError(tAuth(authErrorMessageKey(err)));
    } finally {
      setEmailLoading(false);
    }
  }, [emailPassword, newEmail, userEmail, t, tAuth]);

  const cancelEmailForm = () => {
    setShowEmailForm(false);
    setEmailPassword('');
    setNewEmail('');
    setEmailError(null);
    setShowEmailPwd(false);
  };

  return (
    <>
      <div className="setting-item">
        <div className="setting-item__info">
          <span className="setting-item__label">{t('account_current_email')}</span>
          <span className="setting-item__desc">{user?.email || '—'}</span>
        </div>
        {!effectiveShowEmailForm && (
          <NyxButton
            data-testid="settings-email-change"
            variant="primary"
            size="sm"
            color="blue"
            onClick={() => { setShowEmailForm(true); setEmailSuccess(null); }}
          >
            {t('account_change')}
          </NyxButton>
        )}
      </div>

      {effectiveShowEmailForm && (
        <div className="setting-item setting-item--form">
          <PasswordInput
            placeholder={t('account_current_password')}
            value={emailPassword}
            onChange={setEmailPassword}
            autoComplete="current-password"
            visible={showEmailPwd}
            onToggleVisible={() => setShowEmailPwd((v) => !v)}
          />
          <input
            data-testid="settings-email-input"
            className="settings-input"
            type="email"
            placeholder={t('account_new_email')}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            autoComplete="email"
          />
          {effectiveEmailError && <div className="settings-inline-error">{effectiveEmailError}</div>}
          <div className="settings-form-actions">
            <NyxButton
              data-testid="settings-email-save"
              variant="primary"
              size="xs"
              color="blue"
              onClick={() => void handleChangeEmail()}
              disabled={effectiveEmailLoading}
            >
              {effectiveEmailLoading ? '…' : t('account_confirm')}
            </NyxButton>
            <NyxButton
              data-testid="settings-email-cancel"
              variant="primary"
              size="xs"
              color="red"
              onClick={cancelEmailForm}
            >
              {t('cancel')}
            </NyxButton>
          </div>
        </div>
      )}
      {effectiveEmailSuccess && <div className="settings-inline-success">{effectiveEmailSuccess}</div>}
    </>
  );
};

export default EmailSetting;
