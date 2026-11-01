/**
 * CategoryDetailCard — Carte individuelle pour la grille catégorie.
 *
 * Affiche une carte avec poster, hover effects, marquee titre,
 * et bouton watchlist. Composant memoizé (React.memo).
 *
 * Extrait de CategoryDetailPage.tsx pour séparation des responsabilités.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { isInWatchlist, onWatchlistChange } from '../../services/watchlistHydration';
import { toggleWatchlistOrNotify } from '../../services/watchlistActions';
import WatchlistButton from '../Common/WatchlistButton';
import { clickableProps } from '../../utils/clickable';
import { useTvLongPress } from '../../hooks/useTvLongPress';
import type { IptvStream, IptvSeries } from '../../types/iptv';
import { warnOnReject } from '../../utils/warnOnReject';
import { hoverOpensDetails, markTitleOverflow } from './cardTitle';
import { areGridPostersPaced, attachGridPoster } from './gridPoster';

// Union type for category items (movies or series)
export type CategoryItem = IptvStream | IptvSeries;

// Grid layout constants (shared with CategoryDetailPage)
export const CARD_ASPECT_RATIO = 3 / 2; // height = width * 1.5

interface CategoryDetailCardProps {
    item: CategoryItem;
    type: 'movies' | 'series';
    /** Même fonction pour toutes les cartes : la carte reste mémoïsée quand la grille se redessine (rangée montée au
     * défilement) */
    onSelect: (item: CategoryItem) => void;
    cardWidth: number;
}

const CategoryDetailCard = React.memo<CategoryDetailCardProps>(({ item, type, onSelect, cardWidth }) => {
    const { t } = useTranslation('details');
    const [showDetails, setShowDetails] = useState(false);
    const [imageError, setImageError] = useState(false);
    const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);

    const itemType = type === 'movies' ? 'movie' : 'series';
    const tmdbId = (item.tmdb || 0) as number;
    const imageUrl =
        ('cover' in item ? item.cover : '') || ('stream_icon' in item ? item.stream_icon : '') || '';

    // Extract streamId early for reuse
    const rawStreamId =
        ('stream_id' in item ? item.stream_id : undefined) ||
        ('series_id' in item ? item.series_id : undefined);
    const streamId = typeof rawStreamId === 'string' ? parseInt(rawStreamId, 10) : (rawStreamId || 0);

    const [inWatchlist, setInWatchlist] = useState(false);
    const onClick = useCallback(() => onSelect(item), [onSelect, item]);

    // Load watchlist status async - use tmdbId if available, otherwise streamId
    const reloadWatchlistStatus = useCallback(() => {
        if (tmdbId > 0 || streamId > 0) {
            isInWatchlist(streamId, tmdbId, itemType).then(setInWatchlist).catch(warnOnReject('CategoryDetailCard'));
        }
    }, [tmdbId, streamId, itemType]);

    useEffect(() => {
        reloadWatchlistStatus();
    }, [reloadWatchlistStatus]);

    // Ma liste changée ailleurs (fiche ouverte par-dessus la page, autre appareil) : la page « Voir tout »
    // reste montée sous la fiche, la carte relit son état comme celles de l'accueil (CarouselCard)
    useEffect(() => {
        if (tmdbId > 0 || streamId > 0) return onWatchlistChange(reloadWatchlistStatus);
    }, [tmdbId, streamId, reloadWatchlistStatus]);

    const handleMouseEnter = useCallback(() => {
        // TV : seulement après un vrai geste de souris (cardTitle.ts)
        if (!hoverOpensDetails()) return;
        hoverTimerRef.current = setTimeout(() => {
            setShowDetails(true);
        }, 400);
    }, []);

    const handleMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
        setShowDetails(false);
    }, []);

    const handleAddToList = useCallback(async (e?: React.MouseEvent) => {
        e?.stopPropagation();

        // Allow toggle if we have at least one valid ID
        if (tmdbId <= 0 && streamId <= 0) return;

        const newState = await toggleWatchlistOrNotify(streamId, tmdbId, itemType);
        if (newState !== null) setInWatchlist(newState);
    }, [tmdbId, streamId, itemType]);

    // Télécommande, comme les cartes de l'accueil (CarouselCard) : la carte est un arrêt (OK ouvre),
    // l'appui long sur OK ajoute à Ma liste ou retire. Sans cela, aucune affiche de « Voir tout »
    // n'était atteignable sur TV (seul le bouton Ma liste, invisible hors survol, était focusable).
    const rootRef = useRef<HTMLDivElement>(null);
    const hasWatchlist = tmdbId > 0 || streamId > 0;
    const tvLongPress = useTvLongPress(rootRef, hasWatchlist ? () => { void handleAddToList(); } : undefined);

    // TV : affiche réduite, posée à son tour hors de React, case grise nue d'ici là (gridPoster.ts). Réglage lu à la
    // création de la carte (témoin des mesures : l'affiche d'avant)
    const [pacedPoster] = useState(() => tvLongPress.tv && areGridPostersPaced());
    const imgRef = useRef<HTMLImageElement>(null);
    const posterFailed = useCallback(() => setImageError(true), []);
    useEffect(() => {
        const img = imgRef.current;
        const card = rootRef.current;
        if (!pacedPoster || !img || !card || !imageUrl) return undefined;
        return attachGridPoster(img, card, imageUrl, posterFailed);
    }, [pacedPoster, imageUrl, posterFailed]);

    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        };
    }, []);

    // Marquee detection
    const titleRef = useRef<HTMLDivElement>(null);
    const [needsMarquee, setNeedsMarquee] = useState(false);

    useEffect(() => {
        if (titleRef.current && showDetails) {
            const container = titleRef.current;
            const textElement = container.querySelector('.title-text') as HTMLElement;
            if (textElement) {
                setNeedsMarquee(textElement.scrollWidth > container.clientWidth);
            }
        }
    }, [showDetails, item.name]);

    const cardClasses = [
        'category-detail-card',
        showDetails ? 'show-details' : '',
        needsMarquee ? 'needs-marquee' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const cardHeight = cardWidth * CARD_ASPECT_RATIO;

    return (
        <div
            ref={rootRef}
            className={cardClasses}
            {...tvLongPress.rootProps}
            {...clickableProps(onClick)}
            data-testid="category-card"
            data-media-type={itemType}
            aria-label={item.name}
            onClick={onClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            // TV : le titre de la carte focusée s'affiche, et défile s'il est trop long (cardTitle.ts, tv.css)
            onFocus={tvLongPress.tv ? (e) => { if (e.target === e.currentTarget) markTitleOverflow(e.currentTarget, titleRef.current); } : undefined}
            style={{ width: cardWidth, height: cardHeight }}
        >
            <div className="card-poster">
                <div className="card-top-gradient" />

                {hasWatchlist && (
                    <WatchlistButton
                        isAdded={inWatchlist}
                        onClick={(e) => void handleAddToList(e)}
                        size="sm"
                        title={inWatchlist ? t('remove_from_list') : t('add_to_list')}
                        className="card-watchlist-btn"
                        testId="category-card-watchlist"
                        focusable={!tvLongPress.tv}
                    />
                )}

                {!imageError && imageUrl ? (
                    // TV : sans adresse ni texte de remplacement au rendu, l'adresse est posée par gridPoster.ts
                    pacedPoster ? <img ref={imgRef} alt="" loading="lazy" />
                        : <img src={imageUrl} alt={item.name} loading="lazy" onError={() => setImageError(true)} />
                ) : (
                    <div className="card-fallback">
                        <span className="fallback-title">{item.name}</span>
                    </div>
                )}

                <div ref={titleRef} className="card-title-overlay">
                    <span className="title-text">{item.name}</span>
                    {/* Seconde copie pour la boucle ; toujours là sur TV, affichée seulement si le titre défile */}
                    {(needsMarquee || tvLongPress.tv) && <span className="title-text title-text--copy" aria-hidden="true">{item.name}</span>}
                </div>
            </div>
        </div>
    );
});

CategoryDetailCard.displayName = 'CategoryDetailCard';

export default CategoryDetailCard;
