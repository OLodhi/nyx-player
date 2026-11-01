/**
 * Lecteur — barre de progression. Au doigt et à la souris via `useProgressScrub` ; à la télécommande
 * (hors direct) c'est un curseur atteignable au focus, que `usePlayerRemote` déplace.
 */

import React from 'react';
import type { ProgressScrub } from '../../../hooks/useProgressScrub';
import { formatTime } from './formatTime';

interface ProgressBarProps {
  progressRef: React.RefObject<HTMLDivElement | null>;
  scrub: ProgressScrub;
  /** Avancement affiché, en % */
  progress: number;
  /** Position affichée (s), celle du doigt pendant un glisser */
  displayTime: number;
  duration: number;
  /** Télécommande hors direct : la barre prend le focus */
  focusable: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progressRef, scrub, progress, displayTime, duration, focusable }) => (
  <div
    className={`player-progress-container ${scrub.scrubPercent !== null ? 'scrubbing' : ''}`}
    ref={progressRef as React.RefObject<HTMLDivElement>}
    data-testid="player-progress"
    {...(focusable ? { tabIndex: 0, role: 'slider', 'aria-valuemin': 0, 'aria-valuemax': Math.round(duration), 'aria-valuenow': Math.round(displayTime), 'aria-valuetext': formatTime(displayTime) } : {})}
    onClick={scrub.onClick}
    onPointerDown={scrub.onPointerDown}
    onPointerMove={scrub.onPointerMove}
    onPointerUp={scrub.onPointerUp}
    onPointerCancel={scrub.onPointerCancel}
  >
    <div className="player-progress-bg">
      <div className="player-progress-fill" style={{ width: `${progress}%` }} />
      <div className="player-progress-handle" style={{ left: `${progress}%` }} />
    </div>
  </div>
);

export default ProgressBar;
