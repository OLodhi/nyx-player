import React from 'react';
import { openExternalLink } from '../../services/externalLink';
import './TrailerCard.css';

interface TrailerCardProps {
    /** YouTube video key */
    trailerKey: string;
    /** Fallback image URL when YouTube thumbnail is unavailable */
    backdropUrl: string;
}

/**
 * Composant pur : carte trailer YouTube avec cascade de fallback images.
 * Priorité thumbnails : maxresdefault → hqdefault → backdropUrl.
 */
const TrailerCard: React.FC<TrailerCardProps> = ({ trailerKey, backdropUrl }) => {
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(trailerKey)}`;
    return (
        // Ouverte dans le navigateur de l'appareil : sur Android, un lien `target="_blank"` chargeait
        // YouTube dans la fenêtre de l'app, à la place de l'app (la fenêtre refuse désormais toute page
        // qui n'est pas la sienne)
        <a
            href={url}
            onClick={(e) => {
                e.preventDefault();
                void openExternalLink(url);
            }}
            className="trailer-card"
            data-testid="detail-trailer"
        >
            <img
                src={`https://img.youtube.com/vi/${trailerKey}/maxresdefault.jpg`}
                alt="Trailer"
                onLoad={(e) => {
                    const img = e.target as HTMLImageElement;
                    // YouTube returns a 120x90 placeholder when a specific quality is unavailable
                    if (img.naturalWidth === 120 && img.naturalHeight === 90) {
                        if (img.src.includes('maxresdefault')) {
                            img.src = `https://img.youtube.com/vi/${trailerKey}/hqdefault.jpg`;
                        } else if (img.src.includes('hqdefault') && backdropUrl) {
                            img.src = backdropUrl;
                        }
                    }
                }}
                onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    if (img.src.includes('maxresdefault')) {
                        img.src = `https://img.youtube.com/vi/${trailerKey}/hqdefault.jpg`;
                    } else if (img.src.includes('hqdefault') && backdropUrl) {
                        img.src = backdropUrl;
                    }
                }}
            />
            <div className="trailer-overlay">
                <span className="trailer-label">Trailer</span>
            </div>
        </a>
    );
};

export default TrailerCard;
