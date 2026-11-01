/**
 * useTvLongPress — Appui long sur OK à la télécommande (Android TV).
 *
 * Une carte reste un seul arrêt du parcours : OK l'ouvre, et un appui long déclenche directement
 * son action secondaire (Ma liste, favori, remise à zéro d'un épisode…). Les boutons internes ne
 * sont jamais focusables sur TV. L'action ne se déclenche qu'une fois par appui : il faut relâcher
 * OK pour recommencer (mécanique : utils/spatialNavigation/).
 *
 * Hors TV, le hook ne fait rien.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { isTv } from '../utils/platform';

export interface TvLongPress {
  /** Attributs à poser sur l'élément focusable */
  rootProps: Record<string, string>;
  /** Plateforme TV : les boutons internes des cartes sortent du parcours */
  tv: boolean;
}

/**
 * @param rootRef élément focusable qui reçoit l'appui
 * @param onLongPress action déclenchée (rien si absente)
 * @param passive l'appui court garde son effet natif (champ de saisie : ouvrir le clavier)
 */
export function useTvLongPress(
  rootRef: RefObject<HTMLElement | null>,
  onLongPress: (() => void) | undefined,
  passive = false,
): TvLongPress {
  const tv = isTv();
  const handlerRef = useRef(onLongPress);
  useEffect(() => {
    handlerRef.current = onLongPress;
  });

  const enabled = tv && onLongPress !== undefined;

  useEffect(() => {
    const root = rootRef.current;
    if (!enabled || !root) return;
    const onEvent = () => handlerRef.current?.();
    root.addEventListener('nyx:longpress', onEvent);
    return () => root.removeEventListener('nyx:longpress', onEvent);
  }, [enabled, rootRef]);

  const rootProps: Record<string, string> = {};
  if (enabled) rootProps['data-nav-longpress'] = passive ? 'passive' : '';
  return { rootProps, tv };
}
