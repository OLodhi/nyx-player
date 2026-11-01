import React from 'react';
import { useTranslation } from 'react-i18next';
import NyxButton from '../Common/NyxButton';

// ============================================================================
// TYPES
// ============================================================================
interface DataSectionProps {
    cacheStats: { movies: number; tv: number; movieDetails: number; tvDetails: number };
    cacheSize: { formatted: string };
    cacheCleared: boolean;
    onResetMovies: () => void;
    onResetSeries: () => void;
    onFullReset: () => void;
}

// ============================================================================
// COMPONENT
// ============================================================================
const DataSection: React.FC<DataSectionProps> = ({
    cacheStats,
    cacheSize,
    cacheCleared,
    onResetMovies,
    onResetSeries,
    onFullReset,
}) => {
    const { t } = useTranslation('settings');

    return (
        <section className="settings-section">
            <h3>
                <span className="section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '1.25rem', height: '1.25rem' }}><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12" /><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" /></svg></span>
                {t('data_title')}
                <span className="cache-size-badge">{cacheSize.formatted}</span>
            </h3>
            <div className="stats-row">
                <div className="stat-item">
                    <span className="stat-value">{cacheStats.movies}</span>
                    <span className="stat-label">{t('movies_matched')}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-value">{cacheStats.tv}</span>
                    <span className="stat-label">{t('series_matched')}</span>
                </div>
                <div className="stat-item">
                    <span className="stat-value">{cacheStats.movieDetails + cacheStats.tvDetails}</span>
                    <span className="stat-label">{t('details_cached')}</span>
                </div>
            </div>

            <div className="settings-options">
                <div className="settings-option">
                    <div className="option-info">
                        <span className="option-label">{t('reset_movies')}</span>
                        <span className="option-description">{t('reset_desc_movies')}</span>
                    </div>
                    <NyxButton variant="primary" size="sm" color="blue" onClick={onResetMovies} data-testid="settings-reset-movies">
                        {t('btn_reset')}
                    </NyxButton>
                </div>
                <div className="settings-option">
                    <div className="option-info">
                        <span className="option-label">{t('reset_series')}</span>
                        <span className="option-description">{t('reset_desc_series')}</span>
                    </div>
                    <NyxButton variant="primary" size="sm" color="blue" onClick={onResetSeries} data-testid="settings-reset-series">
                        {t('btn_reset')}
                    </NyxButton>
                </div>
            </div>

            <div className="section-footer">
                    <NyxButton variant="primary" size="sm" color="red" onClick={onFullReset} data-testid="settings-full-reset">
                        🗑️ {t('btn_clear_cache')}
                    </NyxButton>
                {cacheCleared && <div className="success-message">✓ {t('clear_cache_success')}</div>}
            </div>
        </section>
    );
};

export default DataSection;
