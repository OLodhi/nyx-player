import React, { useRef, useState, useEffect } from 'react';
import { CarouselCard } from './CarouselCard';
import type { CarouselItem } from './CarouselCard';
import './ContentCarousel.css';

// Re-export type for consumers
export type { CarouselItem };

export interface ContentCarouselProps {
  title: string;
  items: CarouselItem[];
  loading?: boolean;
  emptyMessage?: string;
  /** Optional icon element displayed before the title */
  titleIcon?: React.ReactNode;
}

const ContentCarousel: React.FC<ContentCarouselProps> = ({ title, items, loading = false, titleIcon }) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStarted, setDragStarted] = useState(false);

  // Refs for drag math
  const dragStartData = useRef({ x: 0, scrollLeft: 0 });
  const historyRef = useRef<{ x: number; time: number }[]>([]);
  const animationRef = useRef<number | null>(null);

  // Global Move Handler
  const handleGlobalMouseMove = useRef((e: MouseEvent) => {
    if (!carouselRef.current) return;
    e.preventDefault();

    const currentX = e.pageX;
    const walk = currentX - dragStartData.current.x;

    if (Math.abs(walk) > 5) setDragStarted(true);
    carouselRef.current.scrollLeft = dragStartData.current.scrollLeft - walk;

    // Add to history for velocity calc
    const now = Date.now();
    historyRef.current.push({ x: currentX, time: now });
    historyRef.current = historyRef.current.filter((h) => now - h.time < 150);
  }).current;

  // Global Up Handler with Inertia
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
    if (Math.abs(velocity) > 0.05 && carouselRef.current) {
      let currentAmplitude = velocity * 25;
      const friction = 0.92;

      const animate = () => {
        if (!carouselRef.current || Math.abs(currentAmplitude) < 0.5) {
          animationRef.current = null;
          return;
        }
        carouselRef.current.scrollLeft -= currentAmplitude;
        currentAmplitude *= friction;
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    }

    setTimeout(() => setDragStarted(false), 100);
  }).current;

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!carouselRef.current) return;

    // Stop any active inertia
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    setIsDragging(true);
    dragStartData.current = {
      x: e.pageX,
      scrollLeft: carouselRef.current.scrollLeft,
    };
    historyRef.current = [{ x: e.pageX, time: Date.now() }];

    // Attach global listeners
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

  return (
    <div className="content-carousel-container" data-testid="carousel-row" data-row-title={title}>
      <h3 className="carousel-title" data-testid="carousel-row-title">{titleIcon}{title}</h3>

      <div
        className={`content-carousel ${isDragging ? 'grabbing' : ''}`}
        data-testid="carousel-row-track"
        data-nav-row
        ref={carouselRef}
        onMouseDown={!loading ? handleMouseDown : undefined}
      >
        {loading
          ? // Skeleton Loading
          [...Array(6)].map((_, i) => (
            <div key={i} className="carousel-card skeleton">
              <div className="skeleton-image" />
            </div>
          ))
          : // Real Items using CarouselCard component
          items.map((item, index) => (
            <CarouselCard key={`${item.id}-${index}`} item={item} dragStarted={dragStarted} />
          ))}
      </div>
    </div>
  );
};

export default ContentCarousel;
