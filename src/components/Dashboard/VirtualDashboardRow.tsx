import React, { useRef, useState, useEffect } from 'react';
import { scrollRoot } from '../../utils/spatialNavigation/dom';
import VirtualContentCarousel, { VirtualCarouselItem } from '../Lists/VirtualContentCarousel';

// Re-export for compatibility



// Hauteur réservée d'un carousel : .virtual-dashboard-row (ContentCarousel.css, surchargée sur mobile)

interface VirtualDashboardRowProps {
    title: string;
    items: VirtualCarouselItem[];
    priority?: boolean;
    rootMargin?: string;
    loading?: boolean;
    gap?: number;
}

/**
 * VirtualDashboardRow - Wrapper for virtualized carousels with lazy loading/unloading
 *
 * Features:
 * - Loads when entering viewport (+ rootMargin buffer)
 * - UNLOADS when leaving viewport (libère mémoire des images décodées)
 * - Uses VirtualContentCarousel for horizontal virtualization (only visible items in DOM)
 * - Placeholder maintains height to prevent scroll jumps
 */
const VirtualDashboardRow: React.FC<VirtualDashboardRowProps> = ({
    title,
    items,
    priority = false,
    rootMargin = '600px', // Buffer plus large pour éviter flash
    loading = false,
    gap,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(priority);

    useEffect(() => {
        // Priority rows are always visible
        if (priority) return;
        if (items.length === 0 && !loading) return;

        const element = containerRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                // Mount when visible, unmount when out of viewport + buffer
                setIsVisible(entry.isIntersecting);
            },
            {
                root: scrollRoot(element),
                rootMargin,
                threshold: 0,
            }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [priority, rootMargin, items.length, loading]);

    // Don't render anything if no items AND not loading
    if (items.length === 0 && !loading) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className="virtual-dashboard-row"
            // Haut/Bas d'un carrousel à l'autre arrive sur la carte dans l'axe (spatialNavigation)
            data-nav-align=""
            style={{
                contain: 'layout', // Évite le reflow
            }}
        >
            {isVisible ? (
                <VirtualContentCarousel title={title} items={items} loading={loading && items.length === 0} gap={gap} />
            ) : null}
        </div>
    );
};

export default React.memo(VirtualDashboardRow);

