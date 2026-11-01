/**
 * useMediaCommands.ts — Chaîne suivante / précédente venue d'Android (MediaSession).
 *
 * L'Assistant (« Ok Google, chaîne suivante ») et les touches « piste suivante / précédente »
 * d'un casque ou d'une télécommande arrivent par le plugin natif. Seule l'interface connaît la
 * catégorie en cours : elle choisit la chaîne voisine, comme Haut / Bas sur la télécommande.
 * Lecture, pause et déplacements sont traités par le plugin lui-même (PlayerMediaSession.kt).
 */

import { useEffect, useRef } from 'react';
import { listenMediaCommands } from '../services/player/mpvApi';
import { createLogger } from '../utils/logger';

const log = createLogger('useMediaCommands');

/**
 * `zap` : chaîne voisine (+1 suivante, -1 précédente) ; absent hors du direct.
 * `showControls` : affiche les contrôles après le changement (nom de la nouvelle chaîne).
 */
export function useMediaCommands(zap: ((delta: number) => void) | undefined, showControls?: () => void): void {
  const zapRef = useRef(zap);
  const showRef = useRef(showControls);
  useEffect(() => {
    zapRef.current = zap;
    showRef.current = showControls;
  });

  const enabled = !!zap;
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listenMediaCommands((command) => {
      const zapNow = zapRef.current;
      if (!zapNow) return;
      zapNow(command === 'next' ? 1 : -1);
      showRef.current?.();
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => log.error('listen failed:', e));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);
}
