import React, { useState, useEffect } from 'react';
import NyxDropdown from '../Common/NyxDropdown';
import { useTranslation } from 'react-i18next';
import {
    getCarouselPreferences,
    isCarouselEnabled,
    isGenreEnabled,
    toggleCarousel,
    toggleGenre,
    isExoticFilterEnabled,
    setExoticFilter,
    getDashboardDefaultMode,
    setDashboardDefaultMode,
    type DashboardDefaultMode,
} from '../../services/preferencesService';
import { DEFAULT_CAROUSELS, TMDB_GENRES } from '../../services/carouselConstants';
import { isEnglish } from '../../utils/tmdbLanguage';
import { CAROUSEL_PREFERENCES_EVENT } from '../../services/eventConstants';
import { clickableProps } from '../../utils/clickable';
import './SettingsCarousels.css';

/**
 * Sous-composant pour un toggle sous forme de "Chip" (Pillule)
 */
const CarouselChip: React.FC<{
    label: string;
    id: string;
    enabled: boolean;
    removable: boolean;
    onToggle: () => void;
}> = ({ label, id, enabled, removable, onToggle }) => (
    // Activable à la télécommande (clickableProps) : une div seule n'est pas un arrêt de la navigation TV
    <div
        className={`toggle-chip ${enabled ? 'active' : ''} ${!removable ? 'disabled' : ''}`}
        data-testid="settings-carousel-chip"
        data-carousel-id={id}
        onClick={removable ? onToggle : undefined}
        {...(removable ? clickableProps(onToggle) : {})}
        aria-pressed={removable ? enabled : undefined}
    >
        <span className="chip-status" />
        <span className="chip-label">{label}</span>
        {!removable && <span className="chip-lock">🔒</span>}
    </div>
);

/**
 * Sous-composant pour une tuile genre interactive
 */
const GenreTile: React.FC<{
    name: string;
    id: number;
    enabled: boolean;
    onToggle: () => void;
}> = ({ name, id, enabled, onToggle }) => (
    <div
        className={`genre-tile ${enabled ? 'active' : ''}`}
        data-testid="settings-genre-tile"
        data-genre-id={id}
        onClick={onToggle}
        {...clickableProps(onToggle)}
        aria-pressed={enabled}
    >
        <span className="genre-name">{name}</span>
        <div className="check-indicator" />
    </div>
);

/**
 * Manager Dashboard Principal - Layout "Control Deck"
 */
const SettingsCarousels: React.FC = () => {
    const { t } = useTranslation('settings');
    // Force re-render on preference change
    const [, setVersion] = useState(0);

    useEffect(() => {
        const handleStorage = () => setVersion((v) => v + 1);
        window.addEventListener(CAROUSEL_PREFERENCES_EVENT, handleStorage);

        return () => {
            window.removeEventListener(CAROUSEL_PREFERENCES_EVENT, handleStorage);
        };
    }, []);

    const triggerUpdate = () => {
        setVersion((v) => v + 1);
    };

    const handleToggleCarousel = (id: string) => {
        void toggleCarousel(id);
        triggerUpdate();
    };

    const handleToggleGenre = (genreId: number) => {
        void toggleGenre(genreId);
        triggerUpdate();
    };

    const handleToggleExoticFilter = () => {
        void setExoticFilter(!isExoticFilterEnabled());
        triggerUpdate();
    };

    const prefs = getCarouselPreferences();
    const enabledGenresCount = prefs.enabledGenres.length;

    // Dashboard default mode (autonome — lecture/écriture directe)
    const [defaultMode, setDefaultModeState] = useState<DashboardDefaultMode>(() => getDashboardDefaultMode());
    const handleDefaultModeChange = (value: DashboardDefaultMode) => {
        setDefaultModeState(value);
        void setDashboardDefaultMode(value);
    };

    return (
        <section className="settings-section settings-section--carousels">
            <div className="settings-section-header">
                <h3>
                    <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg></span>
                    {t('dashboard_content_title')}
                </h3>
                <p>{t('configure_sources_desc')}</p>
            </div>

            <div className="settings-carousels-container">

                {/* 0. Dashboard Default Mode */}
                <div className="control-deck">
                    <span className="deck-label">{t('dashboard_default_mode')}</span>
                    <div className="deck-items">
                        <div className="settings-option inline">
                            <div className="option-info">
                                <span className="option-description">{t('dashboard_default_mode_desc')}</span>
                            </div>
                            <NyxDropdown
                                value={defaultMode}
                                onChange={(v) => handleDefaultModeChange(v as DashboardDefaultMode)}
                                options={[
                                    { value: 'suggestions', label: t('dashboard_mode_suggestions') },
                                    { value: 'films', label: t('dashboard_mode_movies') },
                                    { value: 'series', label: t('dashboard_mode_series') },
                                ]}
                                testId="settings-default-mode"
                            />
                        </div>
                    </div>
                </div>

                {/* 1. Control Deck: Bandeau Horizontal des carousels système */}
                <div className="control-deck">
                    <span className="deck-label">{t('system_deck')}</span>
                    <div className="deck-items">
                        {DEFAULT_CAROUSELS.map((carousel) => (
                            <CarouselChip
                                key={carousel.id}
                                id={carousel.id}
                                label={isEnglish() ? carousel.label_en : carousel.label_fr}
                                enabled={isCarouselEnabled(carousel.id)}
                                removable={carousel.removable !== false}
                                onToggle={() => handleToggleCarousel(carousel.id)}
                            />
                        ))}
                    </div>
                </div>

                {/* 1.5. Language Filter: Latin-only or all scripts */}
                <div className="control-deck language-filter-deck">
                    <span className="deck-label">{t('language_filtering')}</span>
                    <div className="deck-items">
                        <div className="settings-option inline">
                            <div className="option-info">
                                <span className="option-label">{t('latin_only')}</span>
                                <span className="option-description">{t('latin_only_desc')}</span>
                            </div>
                            <label className="toggle-switch">
                                <input
                                    type="checkbox"
                                    data-testid="settings-latin-only-toggle"
                                    checked={isExoticFilterEnabled()}
                                    onChange={handleToggleExoticFilter}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* 2. Grid Panel: Remplissage espace restant pour les Genres */}
                <div className="grid-panel">
                    <div className="panel-header">
                        <h4>
                            <span>{t('tmdb_genres')}</span>
                            <span className="count-badge">
                                {enabledGenresCount} {t('activated')}
                            </span>
                        </h4>
                    </div>

                    <div className="categories-grid-wrapper">
                        <div className="categories-grid">
                            {TMDB_GENRES.map((genre) => (
                                <GenreTile
                                    key={genre.id}
                                    id={genre.id}
                                    name={isEnglish() ? genre.name_en : genre.name_fr}
                                    enabled={isGenreEnabled(genre.id)}
                                    onToggle={() => handleToggleGenre(genre.id)}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default SettingsCarousels;
