import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { restartApp } from '../../services/appRestart';
import type { DnsProvider, HomePageOption } from '../../services/preferencesService';
import { setLanguage } from '../../services/preferencesService';
import { ensureCacheLanguage } from '../../services/tmdbCacheSqlite';
import { getTmdbLanguage } from '../../utils/tmdbLanguage';
import { resetDashboardCache } from '../../hooks/useDashboardData';
import { TMDB_LANGUAGE_EVENT } from '../../services/eventConstants';
import NyxDropdown from '../Common/NyxDropdown';
import ConfirmModal from '../Common/ConfirmModal';
import { isMobile } from '../../utils/platform';

// ============================================================================
// TYPES
// ============================================================================
interface GeneralSectionProps {
    // Interface
    homePage: HomePageOption;
    onHomePageChange: (value: HomePageOption) => void;
    // Network
    dnsProvider: DnsProvider;
    onDnsProviderChange: (value: DnsProvider) => void;
    // Player
    bingeMode: boolean;
    onBingeModeChange: (checked: boolean) => void;
    bingeCountdown: number;
    onBingeCountdownChange: (value: number) => void;
    geekStats: boolean;
    onGeekStatsChange: (checked: boolean) => void;
    // Advanced
    hwAccel: boolean;
    hwAccelLoaded: boolean;
    onHwAccelChange: (enabled: boolean) => Promise<void>;
}

// ============================================================================
// COMPONENT
// ============================================================================
const GeneralSection: React.FC<GeneralSectionProps> = ({
    homePage,
    onHomePageChange,
    dnsProvider,
    onDnsProviderChange,
    bingeMode,
    onBingeModeChange,
    bingeCountdown,
    onBingeCountdownChange,
    geekStats,
    onGeekStatsChange,
    hwAccel,
    hwAccelLoaded,
    onHwAccelChange,
}) => {
    const { t, i18n } = useTranslation('settings');

    // Langue de l'app : textes, puis cache TMDB dans la nouvelle langue, enregistrement et rechargement des
    // titres (aucune étape ne rejette : chacune rattrape ses erreurs)
    const changeLanguage = async (val: string) => {
        resetDashboardCache();
        await i18n.changeLanguage(val);
        await ensureCacheLanguage(getTmdbLanguage());
        void setLanguage(val);
        window.dispatchEvent(new Event(TMDB_LANGUAGE_EVENT));
    };

    // ── Restart modal state ──
    const [showRestartModal, setShowRestartModal] = useState(false);
    const [pendingHwAccel, setPendingHwAccel] = useState<boolean | null>(null);

    const handleHwAccelToggle = (checked: boolean) => {
        // Store the pending value and show confirm modal
        setPendingHwAccel(checked);
        setShowRestartModal(true);
    };

    const handleRestartConfirm = async () => {
        if (pendingHwAccel !== null) {
            await onHwAccelChange(pendingHwAccel);
        }
        setShowRestartModal(false);
        setPendingHwAccel(null);
        // Restart the app so WebView2 picks up the new --disable-gpu flag
        await restartApp();
    };

    const handleRestartCancel = () => {
        setShowRestartModal(false);
        setPendingHwAccel(null);
    };

    // ── Dropdown options ──
    const languageOptions = [
        { value: 'fr', label: 'Français' },
        { value: 'en', label: 'English' },
    ];

    const homePageOptions = [
        { value: 'dashboard', label: t('homepage_dashboard') },
        { value: 'live', label: t('homepage_live') },
        { value: 'watchlist', label: t('homepage_watchlist') },
    ];

    const dnsOptions = [
        { value: 'system', label: t('dns_system') },
        { value: 'cloudflare', label: t('dns_cloudflare') },
        { value: 'quad9', label: 'Quad9 (9.9.9.9)' },
    ];

    const bingeCountdownOptions = [
        { value: '5', label: t('binge_seconds', { count: 5 }) },
        { value: '10', label: t('binge_seconds', { count: 10 }) },
        { value: '15', label: t('binge_seconds', { count: 15 }) },
        { value: '20', label: t('binge_seconds', { count: 20 }) },
        { value: '30', label: t('binge_seconds', { count: 30 }) },
    ];

    return (
        <>
            {/* ── Interface ── */}
            <section className="settings-section">
                <h3>
                    <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg></span>
                    {t('interface_title')}
                </h3>
                <div className="settings-options">
                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('language')}</span>
                            <span className="option-description">{t('language_desc')}</span>
                        </div>
                        <NyxDropdown
                            value={i18n.resolvedLanguage || 'en'}
                            onChange={(val) => { void changeLanguage(val); }}
                            options={languageOptions}
                            testId="settings-language"
                        />
                    </div>
                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('homepage')}</span>
                            <span className="option-description">{t('homepage_desc')}</span>
                        </div>
                        <NyxDropdown
                            value={homePage}
                            onChange={(val) => onHomePageChange(val as HomePageOption)}
                            options={homePageOptions}
                            testId="settings-homepage"
                        />
                    </div>
                </div>
            </section>

            <div className="settings-separator" />

            {/* ── Réseau ── */}
            <section className="settings-section">
                <h3>
                    <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg></span>
                    {t('network_title')}
                </h3>
                <div className="settings-options">
                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('dns_provider')}</span>
                            <span className="option-description">{t('dns_description')}</span>
                        </div>
                        <NyxDropdown
                            value={dnsProvider}
                            onChange={(val) => onDnsProviderChange(val as DnsProvider)}
                            options={dnsOptions}
                            testId="settings-dns"
                        />
                    </div>
                </div>
            </section>

            <div className="settings-separator" />

            {/* ── Lecteur ── */}
            <section className="settings-section">
                <h3>
                    <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg></span>
                    {t('player_title')}
                </h3>
                <div className="settings-options">
                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('binge_mode')}</span>
                            <span className="option-description">{t('binge_description')}</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={bingeMode}
                                data-testid="settings-binge-toggle"
                                onChange={(e) => onBingeModeChange(e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    {bingeMode && (
                        <div className="settings-option">
                            <div className="option-info">
                                <span className="option-label">{t('binge_countdown')}</span>
                                <span className="option-description">{t('binge_countdown_desc')}</span>
                            </div>
                            <NyxDropdown
                                value={String(bingeCountdown)}
                                onChange={(val) => onBingeCountdownChange(Number(val))}
                                options={bingeCountdownOptions}
                                testId="settings-binge-countdown"
                            />
                        </div>
                    )}

                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('tech_info')}</span>
                            <span className="option-description">{t('tech_info_desc')}</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={geekStats}
                                data-testid="settings-geek-stats-toggle"
                                onChange={(e) => onGeekStatsChange(e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </section>

            {/* ── Avancé (desktop : flag GPU WebView2 + hwdec mpv, sans objet sur Android) ── */}
            {!isMobile() && (<>
            <div className="settings-separator" />

            <section className="settings-section">
                <h3>
                    <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg></span>
                    {t('advanced_title')}
                </h3>
                <div className="settings-options">
                    <div className="settings-option">
                        <div className="option-info">
                            <span className="option-label">{t('hardware_acceleration')}</span>
                            <span className="option-description">{t('hardware_acceleration_desc')}</span>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={hwAccel}
                                data-testid="settings-hw-accel-toggle"
                                disabled={!hwAccelLoaded}
                                onChange={(e) => handleHwAccelToggle(e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </section>
            </>)}

            {/* ── Restart Confirm Modal ── */}
            <ConfirmModal
                testId="hardware-acceleration-restart-modal"
                isOpen={showRestartModal}
                title={t('hardware_acceleration_restart_title')}
                message={t('hardware_acceleration_restart_msg')}
                confirmText={t('btn_restart')}
                cancelText={t('btn_later')}
                danger={false}
                onConfirm={() => void handleRestartConfirm()}
                onCancel={handleRestartCancel}
            />
        </>
    );
};

export default GeneralSection;
