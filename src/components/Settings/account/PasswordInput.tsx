/**
 * Champ mot de passe avec l'œil qui l'affiche ou le cache, commun aux formulaires de l'écran
 * Compte (email, mot de passe, suppression). L'œil est hors de la tabulation (`tabIndex={-1}`).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOpen, EyeClosed } from '../../Common/EyeIcons';

interface PasswordInputProps {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  visible: boolean;
  onToggleVisible: () => void;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  placeholder,
  value,
  onChange,
  autoComplete,
  visible,
  onToggleVisible,
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="settings-input-wrapper">
      <input
        data-testid="settings-password-input"
        className="settings-input"
        type={visible ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
      <button
        data-testid="settings-password-input-toggle"
        type="button"
        className="settings-input-eye"
        onClick={onToggleVisible}
        tabIndex={-1}
        aria-label={visible ? t('password_hide') : t('password_show')}
      >
        {visible ? <EyeClosed /> : <EyeOpen />}
      </button>
    </div>
  );
};

export default PasswordInput;
