/**
 * ProfileSelectorPage — Page de sélection de profil (Phase 2)
 *
 * Affiche les profils disponibles dans un style premium clean.
 * En v1 : mono-profil, bouton "Nouveau Profil" disabled avec badge "Bientôt".
 * Clic sur un profil → sélection directe.
 *
 * Props :
 *   profiles         — liste des profils
 *   onSelectProfile  — callback quand un profil est cliqué
 *   onSignOut        — callback Supabase signOut
 */

import React, { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserProfile } from '../services/profileService';
import logoSecondaireBlanc from '../assets/brand/logo-secondaire-blanc.svg';
import NyxButton from '../components/Common/NyxButton';
import LocalDatabaseDamagedNotice from '../components/Common/LocalDatabaseDamagedNotice';
import { useLocalDatabaseDamaged } from '../services/localDatabaseHealth';
import { useTvPageFocus } from '../hooks/useTvPageFocus';
import { isTv } from '../utils/platform';
import './ProfileSelectorPage.css';

interface ProfileSelectorPageProps {
    profiles: UserProfile[];
    onSelectProfile: (profileId: string) => void;
    onSignOut: () => void;
}

const ProfileSelectorPage: React.FC<ProfileSelectorPageProps> = ({
    profiles,
    onSelectProfile,
    onSignOut,
}) => {
    const { t, i18n } = useTranslation('common');

    const toggleLanguage = useCallback(() => {
        void i18n.changeLanguage(i18n.resolvedLanguage === 'fr' ? 'en' : 'fr');
    }, [i18n]);

    // Télécommande : le focus part du dernier profil utilisé, sinon du premier
    const rootRef = useRef<HTMLDivElement>(null);
    useTvPageFocus(rootRef, ['.profile-card[data-last-used]', '.profile-card'], profiles.length > 0, 'profiles');
    const lastUsedId = profiles.find((profile) => profile.is_active)?.id;
    // Bandeau « base abîmée » affiché : l'écran se resserre sur TV (tv.css), sinon il poussait
    // « Se déconnecter » sous le bas de la toile de 720 px
    const dbDamaged = useLocalDatabaseDamaged();

    return (
        <div className="profile-selector" ref={rootRef} data-testid="profile-selector">
            {/* Globe toggle — langue pré-login (localStorage only) */}
            <button
                data-testid="profile-language"
                data-nav-row="profile-language"
                type="button"
                className="lang-toggle"
                onClick={toggleLanguage}
                aria-label={t('toggle_language')}
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                {' '}{i18n.resolvedLanguage === 'fr' ? 'FR' : 'EN'}
            </button>

            <div className={dbDamaged ? 'profile-selector__content profile-selector__content--db-damaged' : 'profile-selector__content'}>
                <img
                    src={logoSecondaireBlanc}
                    alt="Nyx Player"
                    className="profile-selector__logo"
                    // TV : taille donnée par tv.css (logo réduit pour que l'écran tienne dans la zone sûre)
                    style={isTv() ? undefined : { height: '9rem', width: 'auto' }}
                />

                {/* Base de l'appareil abîmée : dit ici, le démarrage avec une session enregistrée passe
                    par cet écran avant celui du fournisseur */}
                <LocalDatabaseDamagedNotice testId="profile-db" className="profile-selector__db-damaged" navRow="profile-db-damaged" />

                <h1 className="profile-selector__title">
                    {t('profile_who_watching')}
                </h1>

                <div className="profile-selector__grid" data-nav-row="profile-cards">
                    {profiles.map((profile) => (
                        <div key={profile.id} className="profile-card-wrapper">
                            <button
                                className="profile-card"
                                data-testid="profile-card"
                                data-last-used={profile.id === lastUsedId ? '' : undefined}
                                onClick={() => onSelectProfile(profile.id)}
                            >
                                <div
                                    className="profile-card__avatar"
                                    style={{ backgroundColor: profile.avatar_color }}
                                >
                                    <span className="profile-card__initial">
                                        {profile.display_name.charAt(0).toUpperCase() || '?'}
                                    </span>
                                </div>

                                <span className="profile-card__name" data-testid="profile-card-name">
                                    {profile.display_name}
                                </span>
                            </button>
                        </div>
                    ))}

                    {/* Nouveau Profil — disabled en v1, badge "Bientôt" */}
                    <div className="profile-card-wrapper">
                        <button
                            className="profile-card profile-card--new"
                            data-testid="profile-card-new"
                            disabled
                            title={t('profile_coming_soon')}
                        >
                            <div className="profile-card__avatar profile-card__avatar--new">
                                <span className="profile-card__plus">+</span>
                            </div>
                            <span className="profile-card__name">
                                {t('profile_new')}
                            </span>
                        </button>
                        <span className="profile-card__badge">
                            {t('profile_coming_soon_badge')}
                        </span>
                    </div>
                </div>

                <div className="profile-selector__actions" data-nav-row="profile-sign-out">
                    <NyxButton
                        variant="primary"
                        size="sm"
                        color="red"
                        data-testid="profile-sign-out"
                        onClick={onSignOut}
                    >
                        {t('profile_sign_out')}
                    </NyxButton>
                </div>
            </div>
        </div>
    );
};

export default ProfileSelectorPage;
