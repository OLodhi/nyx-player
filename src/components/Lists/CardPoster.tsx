import React, { useState } from 'react';
import type { CarouselItem } from './CarouselCard';

/**
 * Affiche d'une carte des rangées React (CarouselCard) et ce qui se pose dessus (coins film/série, note, progression,
 * bouton lecture). À placer dans `.card-image-wrapper`. `hidden` : synopsis ouvert (bureau), seule l'affiche reste.
 * Sur TV, les rangées de l'accueil ont leur propre carte (rail/railRow.ts).
 */
export const CardPoster: React.FC<{ item: CarouselItem; hidden?: boolean }> = ({ item, hidden = false }) => {
    const [imageError, setImageError] = useState(false);
    return (
        <>
            {item.mediaType && !hidden && <div className={`card-media-badge ${item.mediaType}`} />}
            {item.image && !imageError ? (
                <img
                    src={item.image}
                    alt={item.title}
                    draggable={false}
                    loading="lazy"
                    onError={() => setImageError(true)}
                />
            ) : (
                <div className="card-placeholder-title">
                    <span>{item.title}</span>
                </div>
            )}

            {/* Default Overlays */}
            {!hidden && (
                <>
                    {item.overlayText && <div className="card-overlay-text">{item.overlayText}</div>}
                    {item.progress !== undefined && (
                        <div className="card-progress-bar" data-testid="carousel-card-progress">
                            <div
                                className="progress-fill"
                                style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                            />
                        </div>
                    )}
                </>
            )}

            {/* Play Button - Glassmorphism (for "Continue Watching") */}
            {item.showPlayButton && !hidden && (
                <div className="card-play-button" data-testid="carousel-card-play">
                    <span className="play-icon">▶</span>
                </div>
            )}
        </>
    );
};
