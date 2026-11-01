import React, { useRef, useState, useEffect } from 'react';
import { scrollRoot } from '../../utils/spatialNavigation/dom';

interface LazyCategoryProps {
    children: React.ReactNode;
    /** Hauteur du placeholder ; par défaut `.lazy-category` (IptvMode.css), adaptée au mobile */
    height?: string | number;
    /** Buffer autour du viewport pour pre-load (défaut: 800px ≈ 1.5 catégorie) */
    rootMargin?: string;
}

/**
 * LazyCategory - Wrapper qui unmount les enfants quand hors viewport
 * 
 * Garantit une hauteur fixe pour éviter les sauts au scroll.
 * Utilise IntersectionObserver pour détecter la visibilité.
 */
const LazyCategory: React.FC<LazyCategoryProps> = ({
    children,
    height,
    rootMargin = '800px', // ~1.5 carousel ahead — balance between RAM and flash
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        // Check immediately if already visible (handles initial load)
        const rect = element.getBoundingClientRect();
        const buffer = 800; // Match rootMargin
        const isInitiallyVisible = rect.top < window.innerHeight + buffer && rect.bottom > -buffer;
        if (isInitiallyVisible) {
            setIsVisible(true);
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                // Mount quand visible, unmount quand hors viewport + buffer
                setIsVisible(entry.isIntersecting);
            },
            {
                root: scrollRoot(element),
                rootMargin, // Buffer autour du viewport
                threshold: 0,
            }
        );

        observer.observe(element);

        return () => {
            observer.disconnect();
        };
    }, [rootMargin]);

    return (
        <div
            ref={containerRef}
            className="lazy-category"
            style={{
                ...(height === undefined ? null : { minHeight: height }),
                // Évite le reflow quand les enfants sont rendus
                contain: 'layout',
            }}
        >
            {isVisible ? children : null}
        </div>
    );
};

export default React.memo(LazyCategory);
