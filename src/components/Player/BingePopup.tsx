import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayIcon } from './PlayerIcons';
import { useTmdbSeries } from '../../hooks/useTmdbSeries';
import type { AppSeriesInfo } from '../../types/xtream';
import './BingePopup.css';

interface BingePopupProps {
    /** Informations sur l'épisode suivant */
    nextEpisode: {
        seasonNumber: number;
        episodeNumber: number;
        episodeTitle?: string;
        episodeCover?: string;
    };
    /** Infos série complète pour la recherche TMDB (optionnel) */
    currentSeries?: AppSeriesInfo;
    /** Image de couverture de la série */
    seriesCover?: string;
    /** Nom de la série */
    seriesName?: string;
    /** Secondes restantes avant auto-play */
    countdown: number;
    /** Durée totale du countdown (pour le ring SVG) */
    countdownMax?: number;
    /** Callback quand l'utilisateur clique sur "Lire maintenant" */
    onPlayNow: () => void;
    /** Callback quand l'utilisateur annule (ferme le popup) */
    onCancel: () => void;
}

/** SVG countdown ring constants */
const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const DEFAULT_COUNTDOWN_MAX = 15;

const BingePopup: React.FC<BingePopupProps> = ({
    nextEpisode,
    seriesCover,
    seriesName,
    countdown,
    countdownMax = DEFAULT_COUNTDOWN_MAX,
    onPlayNow,
    onCancel,
    currentSeries,
}) => {
    const { t } = useTranslation('player');
    const [imgError, setImgError] = useState(false);
    
    // Recherche de l'épisode TMDB pour avoir l'image et le nom en mode "Netflix"
    // Guard: useTmdbSeries retourne un tableau sparse (indexé par episode_number).
    // On doit filtrer les slots undefined avant .find() pour éviter le crash.
    const safeSeries = currentSeries ?? ({ series_id: 0, name: '', episodes: {} } as AppSeriesInfo);
    const { currentSeasonEpisodes } = useTmdbSeries(safeSeries, nextEpisode.seasonNumber);
    const tmdbEp = currentSeasonEpisodes.filter(Boolean).find(e => e.episode_number === nextEpisode.episodeNumber);

    const episodeLabel = `S${String(nextEpisode.seasonNumber).padStart(2, '0')}E${String(nextEpisode.episodeNumber).padStart(2, '0')}`;
    
    // Fallback cascade pour l'image: TMDB (still_path) -> Xtream (film_image) -> Series Cover (Affiche globale)
    const coverImage = tmdbEp?.still_path 
        ? `https://image.tmdb.org/t/p/w500${tmdbEp.still_path}`
        : nextEpisode.episodeCover || seriesCover;

    // Fallback cascade pour le titre: TMDB -> Xtream -> Optionnel
    const title = tmdbEp?.name || nextEpisode.episodeTitle;

    // Ring progress: from full (countdown=max) to empty (countdown=0)
    const progress = Math.max(0, Math.min(1, countdown / countdownMax));
    const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

    return (
        <div className="binge-popup">
            {/* Cover image — full width 16:9 */}
            <div className="binge-popup-cover">
                {coverImage && !imgError ? (
                    <img 
                      src={coverImage} 
                      alt={title || seriesName || 'Série'} 
                      className={tmdbEp?.still_path || nextEpisode.episodeCover ? 'is-episode-image' : 'is-poster-image'}
                      onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="binge-popup-cover-placeholder">
                        <PlayIcon />
                    </div>
                )}

                {/* Close button — inside cover, top-right */}
                <button className="binge-popup-close" onClick={onCancel} title={t('binge_cancel')} data-testid="binge-cancel">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                </button>
            </div>

            {/* Body */}
            <div className="binge-popup-body">
                {/* Episode info */}
                <div className="binge-popup-content">
                    <span className="binge-popup-label">{t('binge_next_episode')}</span>
                    <span className="binge-popup-episode">{episodeLabel}</span>
                    {title && (
                        <span className="binge-popup-title" title={title}>{title}</span>
                    )}
                </div>

                {/* Footer: countdown ring + play button */}
                <div className="binge-popup-footer">
                    <div className="binge-popup-countdown">
                        <svg viewBox="0 0 44 44">
                            <circle className="countdown-ring-bg" cx="22" cy="22" r={RING_RADIUS} />
                            <circle
                                className="countdown-ring-fill"
                                cx="22"
                                cy="22"
                                r={RING_RADIUS}
                                strokeDasharray={RING_CIRCUMFERENCE}
                                strokeDashoffset={dashOffset}
                            />
                        </svg>
                        <div className="countdown-text">
                            <span className="countdown-number">{countdown}</span>
                            <span className="countdown-label">{t('binge_seconds')}</span>
                        </div>
                    </div>

                    <button className="binge-popup-play" onClick={onPlayNow} data-testid="binge-play-now">
                        {t('binge_play_now')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BingePopup;
