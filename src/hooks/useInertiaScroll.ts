import { useRef, useState, useEffect, useCallback } from 'react';

interface UseInertiaScrollResult {
  ref: React.RefObject<HTMLDivElement>;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
  dragStarted: boolean; // True if user has dragged > 10px
}

export const useInertiaScroll = (): UseInertiaScrollResult => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStarted, setDragStarted] = useState(false);

  const dragStartData = useRef({ x: 0, scrollLeft: 0 });
  const historyRef = useRef<{ x: number; time: number }[]>([]);
  const animationRef = useRef<number | null>(null);
  const dragResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable handler refs (same pattern as ContentCarousel)
  // eslint-disable-next-line react-hooks/refs -- gestionnaire stable (même fonction à l'ajout et au retrait des écouteurs du document)
  const handleGlobalMouseMove = useRef((e: MouseEvent) => {
    if (!ref.current) return;
    e.preventDefault();

    const currentX = e.pageX;
    const walk = currentX - dragStartData.current.x;

    if (Math.abs(walk) > 10) setDragStarted(true);

    ref.current.scrollLeft = dragStartData.current.scrollLeft - walk;

    // History for velocity
    const now = Date.now();
    historyRef.current.push({ x: currentX, time: now });
    historyRef.current = historyRef.current.filter((h) => now - h.time < 150);
  }).current;

  // eslint-disable-next-line react-hooks/refs -- gestionnaire stable (même fonction à l'ajout et au retrait des écouteurs du document)
  const handleGlobalMouseUp = useRef(() => {
    // Immediately remove listeners (stable refs = correct removal)
    document.removeEventListener('mousemove', handleGlobalMouseMove);
    document.removeEventListener('mouseup', handleGlobalMouseUp);

    setIsDragging(false);

    // Reset dragStarted after a small delay to allow click events to check it
    if (dragResetTimerRef.current) clearTimeout(dragResetTimerRef.current);
    dragResetTimerRef.current = setTimeout(() => {
      dragResetTimerRef.current = null;
      setDragStarted(false);
    }, 50);

    // Inertia Logic
    if (!ref.current) return;

    if (historyRef.current.length >= 2) {
      const now = Date.now();
      const latest = historyRef.current[historyRef.current.length - 1];
      const oldest = historyRef.current[0];

      if (now - latest.time < 100) {
        const dx = latest.x - oldest.x;
        const dt = latest.time - oldest.time;
        if (dt > 0) {
          const velocity = dx / dt;
          const friction = 0.95;
          let currentVel = -velocity * 16;

          const animate = () => {
            if (!ref.current) return;
            if (Math.abs(currentVel) < 0.5) return;

            ref.current.scrollLeft += currentVel;
            currentVel *= friction;
            animationRef.current = requestAnimationFrame(animate);
          };
          animate();
        }
      }
    }
  }).current;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;

    // Stop current animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    setIsDragging(true);
    setDragStarted(false);

    dragStartData.current = {
      x: e.pageX,
      scrollLeft: ref.current.scrollLeft,
    };
    historyRef.current = [{ x: e.pageX, time: Date.now() }];

    // Attach global listeners (stable refs)
    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (dragResetTimerRef.current) clearTimeout(dragResetTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/refs -- gestionnaires stables, retirés au démontage
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  return { ref, isDragging, handleMouseDown, dragStarted };
};
