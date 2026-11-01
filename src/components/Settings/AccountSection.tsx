/**
 * AccountSection — Settings section for account management
 *
 * Features (one file per setting in `./account/`):
 * - Profile renaming (inline form, backed by profileService.updateProfileName) — ProfileNameSetting
 * - Display current email + change email (inline form) — EmailSetting
 * - Change password (inline form) — PasswordSetting
 * - Delete account (danger zone, inline confirm) — DeleteAccountSetting
 * Shared: password field with eye toggle (PasswordInput), input checks (accountChecks).
 *
 * Phase 2 refactor: NyxButton xs, SVG eye toggles, DevPanel overrides.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import ProfileNameSetting from './account/ProfileNameSetting';
import { useCloudRefusal } from '../../hooks/useCloudRefusal';
import EmailSetting from './account/EmailSetting';
import PasswordSetting from './account/PasswordSetting';
import DeleteAccountSetting from './account/DeleteAccountSetting';

// ============================================================================
// TYPES
// ============================================================================

interface AccountSectionProps {
  profileName?: string;
  profileId?: string;
  onProfileRenamed?: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================

const AccountSection: React.FC<AccountSectionProps> = ({
  profileName,
  profileId,
  onProfileRenamed,
}) => {
  const { t } = useTranslation('settings');
  // Envoi refusé par le serveur pour une borne dépassée
  const syncRefused = useCloudRefusal();

  return (
    <div className="settings-section">
      <h2 className="settings-section__title"><span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg></span> {t('account_section_title')}</h2>

      {syncRefused && <div className="settings-inline-error" role="status">{t('account_sync_refused')}</div>}

      <ProfileNameSetting
        profileName={profileName}
        profileId={profileId}
        onProfileRenamed={onProfileRenamed}
      />

      <div className="settings-separator" />

      <EmailSetting />

      <div className="settings-separator" />

      <PasswordSetting />

      {/* ---- Danger Zone ---- */}
      <div className="settings-separator" />
      <DeleteAccountSetting />
    </div>
  );
};

export default AccountSection;
