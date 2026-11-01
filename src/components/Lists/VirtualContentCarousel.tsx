import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CarouselCard, type CarouselItem } from './CarouselCard';
import { remToPx } from '../../utils/cssHelpers';
import './ContentCarousel.css';
import { isCompactLayout } from '../../utils/layout';

// Re-export for compatibility
export type VirtualCarouselItem = CarouselItem;

interface VirtualContentCarouselProps {
    title: string;
    items: CarouselItem[];
    loading?: boolean;
    /** Gap between cards in rem (default: 1.25rem = 20px at 16px base) */
    gap?: number;
}

// ============================================================================
// VIRTUAL CONTENT CAROUSEL — Responsive dimensions (rem/vw)
// ============================================================================
// Card CSS: width: clamp(9.5rem, 13vw, 15.625rem), aspect-ratio: 2/3
const CARD_MIN_REM = 9.5;
const CARD_PREFERRED_VW = 13;
const CARD_MAX_REM = 15.625;
const DEFAULT_GAP_REM = 1.25; // 20px at 16px base
const OVERSCAN = 3;

// Téléphone : doit rester aligné sur styles/mobile.css (.carousel-card clamp(6.5rem, 30vw, 9.5rem))
const COMPACT_CARD = { minRem: 6.5, preferredVw: 30, maxRem: 9.5 };

/** Compute card width in px matching the CSS clamp() of the active layout */
function computeCardWidth(): number {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const vw = window.innerWidth;
    const compact = isCompactLayout();
    const min = (compact ? COMPACT_CARD.minRem : CARD_MIN_REM) * rem;
    const preferred = ((compact ? COMPACT_CARD.preferredVw : CARD_PREFERRED_VW) / 100) * vw;
    const max = (compact ? COMPACT_CARD.maxRem : CARD_MAX_REM) * rem;
    return Math.max(min, Math.min(preferred, max));
}

/**
 * Dimensions d'une rangée : la hauteur de la piste ne dépend que de la largeur d'écran, jamais du contenu.
 * Partagée avec les rangées du rail TV (rail/railRow.ts), qui prennent exactement la même place.
 */
export function carouselDims(gap: number = DEFAULT_GAP_REM) {
    const cardW = computeCardWidth();
    const gapPx = remToPx(isCompactLayout() ? Math.min(gap, 0.75) : gap);
    const cardH = cardW * 1.5; // aspect-ratio 2/3
    const paddingTop = remToPx(0.75);
    const paddingBottom = remToPx(2.25); // hover scale(1.05) + box-shadow
    return { cardW, gapPx, cardH, paddingTop, paddingBottom, totalH: cardH + paddingTop + paddingBottom };
}

const VirtualContentCarousel: React.FC<VirtualContentCarouselProps> = ({
    title,
    items,
    loading = false,
    gap = DEFAULT_GAP_REM,
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStarted, setDragStarted] = useState(false);
    const [viewportKey, setViewportKey] = useState(0); // trigger recalc on resize

    // Recalculate on window resize
    useEffect(() => {
        const onResize = () => setViewportKey((k) => k + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    // Responsive dimensions (recalc when viewport changes)
    const dims = useMemo(() => {
        void viewportKey; // dependency trigger
        return carouselDims(gap);
    }, [gap, viewportKey]);

    // Drag state refs
    const dragStartData = useRef({ x: 0, scrollLeft: 0 });
    const historyRef = useRef<{ x: number; time: number }[]>([]);
    const animationRef = useRef<number | null>(null);

    const itemWidth = dims.cardW + dims.gapPx;

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => itemWidth,
        horizontal: true,
        overscan: OVERSCAN,
    });

    // Force virtualizer to recalculate positions on resize
    useEffect(() => {
        if (viewportKey > 0) virtualizer.measure();
    }, [viewportKey, virtualizer]);

    // ========== DRAG HANDLERS (same as ContentCarousel) ==========
    const handleGlobalMouseMove = useRef((e: MouseEvent) => {
        if (!scrollRef.current) return;
        e.preventDefault();

        const currentX = e.pageX;
        const walk = currentX - dragStartData.current.x;

        if (Math.abs(walk) > 5) setDragStarted(true);
        scrollRef.current.scrollLeft = dragStartData.current.scrollLeft - walk;

        const now = Date.now();
        historyRef.current.push({ x: currentX, time: now });
        historyRef.current = historyRef.current.filter((h) => now - h.time < 150);
    }).current;

    const handleGlobalMouseUp = useRef(() => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleGlobalMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);

        const now = Date.now();
        const history = historyRef.current;

        let velocity = 0;
        if (history.length >= 2) {
            const oldest = history[0];
            const newest = history[history.length - 1];

            if (now - newest.time < 80) {
                const dt = newest.time - oldest.time;
                const dx = newest.x - oldest.x;
                if (dt > 10) {
                    velocity = dx / dt;
                }
            }
        }

        // Apply Inertia
        if (Math.abs(velocity) > 0.05 && scrollRef.current) {
            let currentAmplitude = velocity * 25;
            const friction = 0.92;

            const animate = () => {
                if (!scrollRef.current || Math.abs(currentAmplitude) < 0.5) {
                    animationRef.current = null;
                    return;
                }
                scrollRef.current.scrollLeft -= currentAmplitude;
                currentAmplitude *= friction;
                animationRef.current = requestAnimationFrame(animate);
            };
            animationRef.current = requestAnimationFrame(animate);
        }

        setTimeout(() => setDragStarted(false), 100);
    }).current;

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!scrollRef.current) return;

        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }

        setIsDragging(true);
        dragStartData.current = {
            x: e.pageX,
            scrollLeft: scrollRef.current.scrollLeft,
        };
        historyRef.current = [{ x: e.pageX, time: Date.now() }];

        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
    };

    // Cleanup
    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove);
            document.removeEventListener('mouseup', handleGlobalMouseUp);
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
        // Nettoyage au démontage seulement : les deux gestionnaires sont créés une seule fois (useRef)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- gestionnaires stables
    }, []);

    if (!loading && items.length === 0) return null;

    // Calculate total height with padding (extra padding for hover scale 1.05)
    const totalHeight = dims.totalH;

    return (
        <div
            className="content-carousel-container"
            data-testid="carousel-row"
            data-row-title={title}
            style={{
                contentVisibility: 'visible',
            }}
        >
            {loading && items.length === 0 ? (
                <div className="carousel-title skeleton-title" />
            ) : (
                <h3 className="carousel-title" data-testid="carousel-row-title">{title}</h3>
            )}

            <div
                ref={scrollRef}
                className={`content-carousel ${isDragging ? 'grabbing' : ''}`}
                data-testid="carousel-row-track"
                data-nav-row
                onMouseDown={!loading ? handleMouseDown : undefined}
                style={{
                    display: 'block', // Override flex
                    height: `${totalHeight}px`,
                    position: 'relative',
                    padding: 0, // Reset CSS padding — border-box makes it eat into height
                }}
            >
                {loading ? (
                    // Skeleton loading
                    <div style={{ display: 'flex', gap: `${dims.gapPx}px`, padding: '1.5rem 4vw 2.5rem var(--sidebar-safe-zone)' }}>
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="carousel-card skeleton">
                                <div className="skeleton-image" />
                            </div>
                        ))}
                    </div>
                ) : (
                    // Virtual container
                    <div
                        style={{
                            width: `${virtualizer.getTotalSize()}px`,
                            height: `${dims.cardH}px`,
                            position: 'relative',
                            marginTop: `${dims.paddingTop}px`,
                            marginLeft: 'var(--sidebar-safe-zone)',
                        }}
                    >
                        {virtualizer.getVirtualItems().map((virtualItem) => (
                            <div
                                key={virtualItem.key}
                                data-index={virtualItem.index}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    height: `${dims.cardH}px`,
                                    width: `${dims.cardW}px`, // Card width only, gap is in itemWidth
                                    transform: `translateX(${virtualItem.start}px)`,
                                    pointerEvents: dragStarted ? 'none' : 'auto',
                                }}
                            >
                                <CarouselCard item={items[virtualItem.index]} dragStarted={dragStarted} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(VirtualContentCarousel);
