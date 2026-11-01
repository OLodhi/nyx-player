/**
 * CurrentTimeMarker — Ligne verticale rouge positionnée à "maintenant" dans la timeline.
 *
 * Composant isolé : se repositionne toutes les 60 secondes via `setInterval`.
 * 0 re-render du parent GuideTvGrid (state interne uniquement).
 *
 * @param originTs — Minuit UTC du jour courant (ancre fixe du hook)
 * @param remPerMinute — Constante de conversion minutes → rem (0.25)
 */

import { useState, useEffect, memo } from 'react';
import { remToPx } from '../../utils/cssHelpers';

// ============================================================================
// TYPES
// ============================================================================

interface CurrentTimeMarkerProps {
  /** Minuit UTC du jour courant (epoch seconds) */
  originTs: number;
  /** rem par minute (constante GuideTvGrid) */
  remPerMinute: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Calcule la position left en px de "maintenant" par rapport à originTs */
function computeNowLeft(originTs: number, remPerMinute: number): number {
  const nowSec = Date.now() / 1000;
  const minutesSinceOrigin = (nowSec - originTs) / 60;
  return remToPx(minutesSinceOrigin * remPerMinute);
}

// ============================================================================
// COMPONENT
// ============================================================================

const REFRESH_INTERVAL_MS = 60_000;

function CurrentTimeMarkerInner({ originTs, remPerMinute }: CurrentTimeMarkerProps) {
  const [leftPx, setLeftPx] = useState(() => computeNowLeft(originTs, remPerMinute));

  useEffect(() => {
    // Recalculer immédiatement (si props changent)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- position de l'heure courante (horloge externe), recalculée quand l'origine change
    setLeftPx(computeNowLeft(originTs, remPerMinute));

    const timer = setInterval(() => {
      setLeftPx(computeNowLeft(originTs, remPerMinute));
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [originTs, remPerMinute]);

  return (
    <div
      className="guide-time-marker"
      data-testid="guide-now"
      style={{ left: `${leftPx}px` }}
      aria-hidden="true"
    />
  );
}

/**
 * Composant mémoïsé — ne re-render que si originTs ou remPerMinute changent.
 * Le state interne (leftPx) est mis à jour par setInterval sans affecter le parent.
 */
export const CurrentTimeMarker = memo(CurrentTimeMarkerInner);
