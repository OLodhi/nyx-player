import React, { useRef, useState, useEffect, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isInWatchlist, onWatchlistChange } from '../../services/watchlistHydration';
import WatchlistButton from '../Common/WatchlistButton';
import ContentInfoSheet from '../Common/ContentInfoSheet';
import { isCompactLayout } from '../../utils/layout';
import { clickableProps } from '../../utils/clickable';
import { useTvLongPress } from '../../hooks/useTvLongPress';
import { warnOnReject } from '../../utils/warnOnReject';
import { hoverOpensDetails, markTitleOverflow } from './cardTitle';
import { CardPoster } from './CardPoster';
import { cardHasWatchlist, toggleCardWatchlist } from './cardWatchlist';

// ============================================================================
// TYPES
// ============================================================================

export interface CarouselItem {
    id: string | number;
    title: string;
    image: string;
    onClick?: () => void;
    overlayText?: string; // Optional overlay text (e.g., "★ 8.5")
    progress?: number; // Optional progress bar (0-100)
    mediaType?: 'movie' | 'series'; // Optional type for visual distinction
    overview?: string; // Synopsis for hover display
    inWatchlist?: boolean; // Is item in watchlist? (legacy, prefer async)
    onAddToList?: () => void; // Callback for "+" button (legacy, prefer async)
    showPlayButton?: boolean; // Show prominent play button (for "Continue Watching")
    isActionButton?: boolean; // True for "See All" type buttons - disables hover behaviors
    /** Titre introuvable chez le fournisseur actuel (Ma liste) : carte grisée */
    unavailable?: boolean;
    // Async watchlist support (preferred)
    tmdbId?: number;
    streamId?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Individual Card Component - MEMOIZED to avoid unnecessary re-renders.
 * Used by ContentCarousel and VirtualContentCarousel.
 */
export const CarouselCard = memo<{
    item: CarouselItem;
    dragStarted: boolean;
}>(({ item, dragStarted }) => {
    const { t } = useTranslation('common');
    const [showInfo, setShowInfo] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const leaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    const detailsTimerRef = useRef<NodeJS.Timeout | null>(null);

    const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Télécommande : carte = un arrêt (OK ouvre), appui long = ajouter ou retirer de Ma liste
    const rootRef = useRef<HTMLDivElement>(null);

    // Async watchlist state (when tmdbId OR streamId is provided with mediaType)
    const [inWatchlistAsync, setInWatchlistAsync] = useState<boolean | null>(null);
    const hasTmdbId = item.tmdbId !== undefined && item.tmdbId > 0;
    const hasStreamId = item.streamId !== undefined && item.streamId > 0;
    const hasAsyncWatchlist = item.mediaType && (hasTmdbId || hasStreamId);

    // Function to reload watchlist status
    const reloadWatchlistStatus = useCallback(() => {
        if (hasAsyncWatchlist && item.mediaType) {
            isInWatchlist(item.streamId ?? 0, item.tmdbId ?? 0, item.mediaType).then(setInWatchlistAsync).catch(warnOnReject('CarouselCard'));
        }
    }, [hasAsyncWatchlist, item.tmdbId, item.streamId, item.mediaType]);

    // Load watchlist status async on mount
    useEffect(() => {
        reloadWatchlistStatus();
    }, [reloadWatchlistStatus]);

    // Subscribe to watchlist changes from other components
    useEffect(() => {
        if (hasAsyncWatchlist) {
            return onWatchlistChange(reloadWatchlistStatus);
        }
    }, [hasAsyncWatchlist, reloadWatchlistStatus]);

    // Determine final watchlist state (async takes priority)
    const isItemInWatchlist = hasAsyncWatchlist ? inWatchlistAsync === true : item.inWatchlist === true;

    // Téléphone : le synopsis s'ouvre dans une fenêtre lisible au lieu de la carte (trop petite)
    const [showInfoSheet, setShowInfoSheet] = useState(false);
    const compact = isCompactLayout();

    const toggleInfo = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (compact) {
            setShowInfoSheet(true);
            return;
        }
        setShowInfo((prev) => !prev);
    };

    const handleAddToList = async (e?: React.MouseEvent) => {
        e?.stopPropagation();
        const newState = await toggleCardWatchlist(item);
        if (newState !== null) setInWatchlistAsync(newState);
    };

    const hasWatchlist = cardHasWatchlist(item);
    const tvLongPress = useTvLongPress(rootRef, hasWatchlist ? () => { void handleAddToList(); } : undefined);

    const handleMouseEnter = () => {
        // Skip hover behaviors for action buttons ; TV : seulement après un vrai geste de souris (cardTitle.ts)
        if (item.isActionButton || !hoverOpensDetails()) return;

        // 1. Cancel any pending close timer (user came back!)
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        // 2. Cancel any pending info auto-close
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }

        // 3. Start open timer only if not already showing or processing
        if (!showDetails && !detailsTimerRef.current) {
            detailsTimerRef.current = setTimeout(() => {
                setShowDetails(true);
            }, 400); // Reduced to 400ms for snappy responsiveness
        }
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
        // 1. Check strict boundary (relatedTarget)
        const card = e.currentTarget;
        const relatedTarget = e.relatedTarget;

        // Guard: relatedTarget may not be a Node when mouse leaves screen (multi-monitor)
        if (relatedTarget && relatedTarget instanceof Node && card.contains(relatedTarget)) {
            return;
        }

        // 2. Cancel pending open timer (user left before it triggered)
        if (detailsTimerRef.current) {
            clearTimeout(detailsTimerRef.current);
            detailsTimerRef.current = null;
        }

        // 3. Start grace period close timer (debounce)
        closeTimerRef.current = setTimeout(() => {
            setShowDetails(false);

            // Auto-close info after 2s if open
            if (showInfo) {
                setShowInfo(false); // Force close info after grace period
            }
        }, 300); // 300ms grace period

        // Maintain original info auto-close logic (separate from details)
        if (showInfo) {
            leaveTimerRef.current = setTimeout(() => {
                setShowInfo(false);
            }, 2000);
        }
    };

    useEffect(() => {
        return () => {
            if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
            if (detailsTimerRef.current) clearTimeout(detailsTimerRef.current);
            if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        };
    }, []);

    // Ref for title overflow detection
    const titleRef = useRef<HTMLDivElement>(null);
    const [needsMarquee, setNeedsMarquee] = useState(false);

    // Check if title overflows container
    useEffect(() => {
        if (titleRef.current && showDetails) {
            const container = titleRef.current;
            const textElement = container.querySelector('.title-text') as HTMLElement;
            if (textElement) {
                // Check if text is wider than container
                setNeedsMarquee(textElement.scrollWidth > container.clientWidth);
            }
        }
    }, [showDetails, item.title]);

    // Build class names
    const cardClasses = [
        'carousel-card',
        showInfo ? 'show-info' : '',
        showDetails ? 'show-details' : '',
        needsMarquee ? 'needs-marquee' : '',
        item.isActionButton ? 'action-button' : '',
        item.unavailable ? 'carousel-card--unavailable' : '',
        isItemInWatchlist ? 'carousel-card--in-watchlist' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <div
            ref={rootRef}
            className={cardClasses}
            data-media-type={item.mediaType}
            data-testid="carousel-card"
            data-watchlist={hasWatchlist ? '' : undefined}
            {...tvLongPress.rootProps}
            {...clickableProps(() => {
                if (!showInfo && item.onClick) item.onClick();
            })}
            aria-label={item.title}
            onClick={() => {
                if (!dragStarted && !showInfo && item.onClick) item.onClick();
            }}
            onDragStart={(e) => e.preventDefault()}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            // TV : le titre de la carte focusée s'affiche, et défile s'il est trop long (cardTitle.ts, tv.css)
            onFocus={tvLongPress.tv ? (e) => { if (e.target === e.currentTarget) markTitleOverflow(e.currentTarget, titleRef.current); } : undefined}
        >
            <div className="card-image-wrapper">
                <CardPoster item={item} hidden={showInfo} />

                {/* Info Overlay - Synopsis only (title moved to bottom-bar) */}
                <div
                    className={`card-info-overlay ${showInfo ? 'active' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="card-info-content">
                        <p className="card-synopsis">{item.overview || t('no_synopsis')}</p>
                    </div>
                </div>
            </div>

            {/* Watchlist button - top left of card (separate from bottom bar) */}
            {/* Show if: has async watchlist support OR has legacy onAddToList */}
            {hasWatchlist && (
                <WatchlistButton
                    isAdded={isItemInWatchlist}
                    onClick={(e) => void handleAddToList(e)}
                    size="sm"
                    title={isItemInWatchlist ? t('remove_from_watchlist') : t('add_to_watchlist')}
                    className="card-watchlist-btn"
                    testId="carousel-card-watchlist"
                    focusable={!tvLongPress.tv}
                />
            )}

            {/* Bottom Bar: Title + Info button */}
            <div className="card-bottom-bar">
                <div className="title-row">
                    <div ref={titleRef} className="card-title marquee-container">
                        <span className="title-text">{item.title}</span>
                        {/* Seconde copie pour la boucle ; toujours là sur TV, affichée seulement si le titre défile */}
                        {(needsMarquee || tvLongPress.tv) && <span className="title-text title-text--copy" aria-hidden="true">{item.title}</span>}
                    </div>

                    {/* TV : pas de synopsis sur la carte, la fiche détail s'en charge */}
                    {item.overview && !tvLongPress.tv && (
                        <button
                            className={`card-action-btn info-btn ${showInfo ? 'active' : ''}`}
                            data-testid="carousel-card-info"
                            onClick={toggleInfo}
                            title={showInfo ? t('close') : t('more_info')}
                        >
                            <span className="info-icon">i</span>
                            <span className="close-icon">✕</span>
                        </button>
                    )}
                </div>
            </div>

            <ContentInfoSheet
                isOpen={showInfoSheet}
                title={item.title}
                image={item.image}
                badge={item.overlayText}
                overview={item.overview}
                onOpenDetails={item.onClick ? () => { setShowInfoSheet(false); item.onClick?.(); } : undefined}
                inWatchlist={isItemInWatchlist}
                onToggleWatchlist={hasWatchlist ? ((e) => void handleAddToList(e)) : undefined}
                onClose={() => setShowInfoSheet(false)}
            />
        </div>
    );
});

// Display name for debugging
CarouselCard.displayName = 'CarouselCard';
