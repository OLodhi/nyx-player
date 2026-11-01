/**
 * SeriesSkeletons.tsx - Skeletons pour SeriesDetailPage
 *
 * Composants de chargement pour l'interface série.
 * Refactorisé pour utiliser des classes CSS (standards du projet).
 */

import React from 'react';

/**
 * Skeleton pour les informations série (titre, badges, synopsis)
 */
export const SeriesSkeleton: React.FC = () => (
    <div className="series-skeleton">
        {/* Title */}
        <div className="skeleton-item skeleton-title" />

        {/* Badges */}
        <div className="skeleton-badges-row">
            <div className="skeleton-item skeleton-badge" />
            <div className="skeleton-item skeleton-badge" />
            <div className="skeleton-item skeleton-badge" />
            <div className="skeleton-item skeleton-badge" />
            <div className="skeleton-item skeleton-badge" />
        </div>

        {/* Genres */}
        <div className="skeleton-item skeleton-genres" />

        {/* Synopsis */}
        <div className="skeleton-synopsis">
            <div className="skeleton-item skeleton-text" />
            <div className="skeleton-item skeleton-text" />
            <div className="skeleton-item skeleton-text" />
            <div className="skeleton-item skeleton-text" />
        </div>

        {/* Casting */}
        <div className="skeleton-item skeleton-casting" />

        {/* Season Selector area */}
        <div className="skeleton-season-row">
            <div className="skeleton-item skeleton-season-dropdown" />
            <div className="skeleton-item skeleton-episode-count" />
            <div className="skeleton-item skeleton-watchlist-btn" />
        </div>
    </div>
);

/**
 * Skeleton pour le carousel d'épisodes
 */
export const SeriesCarouselSkeleton: React.FC = () => (
    <div className="episodes-carousel-container series-carousel-skeleton">
        <div className="episodes-carousel">
            {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="episode-card-netflix skeleton-episode-card">
                    {/* Thumbnail skeleton */}
                    <div className="skeleton-item skeleton-thumbnail" />
                    {/* Details skeleton */}
                    <div className="skeleton-details">
                        <div className="skeleton-item skeleton-ep-title" />
                        <div className="skeleton-item skeleton-ep-duration" />
                    </div>
                </div>
            ))}
        </div>
    </div>
);
