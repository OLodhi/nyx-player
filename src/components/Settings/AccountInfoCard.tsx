/**
 * AccountInfoCard — Affichage des infos de compte IPTV.
 *
 * Expiration, statut, compteurs de contenu (live/movies/series),
 * et taux d'intégration TMDB.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// TYPES
// ============================================================================
interface AccountInfo {
    username?: string;
    status?: string;
    exp_date?: string;
    is_trial?: string;
    active_cons?: string;
    max_connections?: string;
    created_at?: string;
}

interface ContentCounts {
    live: number;
    movies: number;
    series: number;
    uniqueMovies?: number;
    uniqueSeries?: number;
    tmdbMovies?: number;
    tmdbSeries?: number;
    tmdbMovieRate?: number;
    tmdbSeriesRate?: number;
}

interface AccountInfoCardProps {
    accountInfo: AccountInfo | null;
    contentCounts?: ContentCounts;
    /** DevPanel: force le statut d'expiration */
    forceExpiration?: 'active' | 'expiring' | 'expired' | null;
    /** DevPanel: force le taux TMDB films */
    forceTmdbMovieRate?: number | null;
    /** DevPanel: force le taux TMDB séries */
    forceTmdbSeriesRate?: number | null;
}

// ============================================================================
// COMPONENT
// ============================================================================
const tmdbRateColor = (rate: number): string => {
    if (rate <= 30) return 'var(--color-error)';
    if (rate <= 70) return 'var(--color-warning)';
    return 'var(--color-success)';
};

const AccountInfoCard: React.FC<AccountInfoCardProps> = ({
    accountInfo,
    contentCounts,
    forceExpiration = null,
    forceTmdbMovieRate = null,
    forceTmdbSeriesRate = null,
}) => {
    const { t, i18n } = useTranslation('settings');

    const formatExpirationDate = (
        timestamp?: string,
    ): { date: string; status: 'active' | 'expiring' | 'expired' } => {
        if (!timestamp) return { date: t('not_available'), status: 'active' };

        const expDate = new Date(parseInt(timestamp) * 1000);
        const now = new Date();
        const daysUntilExpiry = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        const formattedDate = expDate.toLocaleDateString(i18n.language, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        let status: 'active' | 'expiring' | 'expired' = 'active';
        if (daysUntilExpiry < 0) {
            status = 'expired';
        } else if (daysUntilExpiry <= 30) {
            status = 'expiring';
        }

        return { date: formattedDate, status };
    };

    const rawExpiration = formatExpirationDate(accountInfo?.exp_date);
    // DevPanel override: force le statut d'expiration sans modifier la date
    const expiration = forceExpiration
        ? { ...rawExpiration, status: forceExpiration }
        : rawExpiration;

    return (
        <div className="settings-subsection">
            <h4>{t('account_title')}</h4>
            <div className="info-grid">
                <div className="info-item">
                    <div className="info-label">{t('expiration')}</div>
                    <div
                        className={`info-value ${expiration.status === 'expired' ? 'danger' : expiration.status === 'expiring' ? 'warning' : 'success'}`}
                    >
                        <div className="expiration-status">
                            <span className={`status-dot ${expiration.status}`}></span>
                            {expiration.date}
                        </div>
                    </div>
                </div>
                <div className="info-item">
                    <div className="info-label">{t('status')}</div>
                    <div
                        className={`info-value ${accountInfo?.status === 'Active' ? 'success' : 'danger'}`}
                    >
                        {accountInfo?.status || t('unknown')}
                    </div>
                </div>
                {accountInfo?.max_connections && (
                    <div className="info-item" title={t('connections_desc')}>
                        <div className="info-label">{t('connections')}</div>
                        <div
                            className={`info-value ${Number(accountInfo.active_cons ?? 0) >= Number(accountInfo.max_connections) ? 'warning' : 'success'}`}
                        >
                            {t('connections_value', { active: accountInfo.active_cons ?? '0', max: accountInfo.max_connections })}
                        </div>
                    </div>
                )}
            </div>
            {contentCounts && (
                <div className="stats-row">
                    <div className="stat-item">
                        <span className="stat-value">{contentCounts.live.toLocaleString()}</span>
                        <span className="stat-label">{t('tv_channels')}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">
                            {(contentCounts.uniqueMovies || contentCounts.movies).toLocaleString()}
                        </span>
                        <span className="stat-label">{t('movies')}</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">
                            {(contentCounts.uniqueSeries || contentCounts.series).toLocaleString()}
                        </span>
                        <span className="stat-label">{t('series')}</span>
                    </div>
                </div>
            )}
            {contentCounts && (() => {
                const movieRate = forceTmdbMovieRate ?? contentCounts.tmdbMovieRate;
                const seriesRate = forceTmdbSeriesRate ?? contentCounts.tmdbSeriesRate;
                return (movieRate || seriesRate) ? (
                    <div className="tmdb-integration-row">
                        <span className="tmdb-label">{t('tmdb_integration')}</span>
                        <span className="tmdb-rates">
                            {t('movies')}{' '}
                            <span className="tmdb-rate-value" style={{ color: tmdbRateColor(movieRate || 0) }}>
                                {movieRate || 0}%
                            </span>
                            {' — '}
                            {t('series')}{' '}
                            <span className="tmdb-rate-value" style={{ color: tmdbRateColor(seriesRate || 0) }}>
                                {seriesRate || 0}%
                            </span>
                        </span>
                    </div>
                ) : null;
            })()}
        </div>
    );
};

export default AccountInfoCard;
