/**
 * useProgressScrub.ts — Barre de progression du lecteur au doigt et à la souris.
 *
 * Tactile / stylet : la position suit le doigt pendant le glisser (`scrubPercent`), la lecture
 * saute à l'endroit où le doigt se lève. Souris : un clic saute directement.
 */

import React, { useState, useCallback } from 'react';

export function useProgressScrub(
  progressRef: React.RefObject<HTMLDivElement | null>,
  duration: number,
  resetHideTimer: () => void,
  handleSeek: (e: React.MouseEvent<HTMLDivElement>) => Promise<void>,
) {
  /** Tactile : position (%) pendant le glisser sur la barre de progression, null hors glisser */
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);

  const percentFromClientX = useCallback((clientX: number) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, [progressRef]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || duration === 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubPercent(percentFromClientX(e.clientX));
  }, [duration, percentFromClientX]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubPercent === null) return;
    setScrubPercent(percentFromClientX(e.clientX));
    resetHideTimer();
  }, [scrubPercent, percentFromClientX, resetHideTimer]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubPercent === null) return;
    setScrubPercent(null);
    void handleSeek(e);
  }, [scrubPercent, handleSeek]);

  const onPointerCancel = useCallback(() => setScrubPercent(null), []);

  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Doigt / stylet : le saut se fait au lâcher, le clic simulé qui suit ne doit pas sauter une 2e fois
    const pointerType = (e.nativeEvent as PointerEvent).pointerType;
    if (pointerType === 'touch' || pointerType === 'pen') return;
    void handleSeek(e);
  }, [handleSeek]);

  return { scrubPercent, onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

export type ProgressScrub = ReturnType<typeof useProgressScrub>;
