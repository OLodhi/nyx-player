/**
 * useTvPageFocus — Focus d'une page au premier plan (fiche film / série) à la télécommande.
 *
 * - À l'ouverture, dès que le contenu est prêt : focus sur l'action principale (Lecture, premier
 *   épisode). Sans ça, le focus reste sur la carte de l'accueil, cachée sous la fiche.
 * - À la fermeture : retour sur l'élément focusé avant l'ouverture (la carte d'où l'on vient).
 *
 * - Pendant ≈ 1,5 s après l'arrivée, le focus est rendu à la cible s'il tombe sur le corps de la
 *   page (utilisé aussi par la sélection du profil : sans ça, un premier appui sur une flèche
 *   était nécessaire avant de pouvoir valider).
 *
 * Hors TV, le hook ne fait rien.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { isTv } from '../utils/platform';

/** Environ une seconde à 60 images par seconde */
const MAX_FOCUS_ATTEMPTS = 60;
/** Veille après l'arrivée : le focus est rendu s'il tombe sur le corps de la page (≈ 1,5 s) */
const GUARD_FRAMES = 90;

/**
 * @param rootRef racine de la page
 * @param initialSelectors cibles possibles, par ordre de préférence
 * @param ready le contenu est affiché
 * @param contentKey identifiant du contenu : une nouvelle fiche dans la même page refocalise
 */
export function useTvPageFocus(
  rootRef: RefObject<HTMLElement | null>,
  initialSelectors: string[],
  ready: boolean,
  contentKey: string | number,
): void {
  const tv = isTv();
  const focusedKey = useRef<string | number | null>(null);
  /** Élément focusé avant l'ouverture, capturé une seule fois (undefined = pas encore capturé) */
  const returnTo = useRef<HTMLElement | null | undefined>(undefined);
  const restoreFrame = useRef(0);

  useEffect(() => {
    if (!tv) return;
    // Remontage immédiat (StrictMode en dev) : ce n'était pas une fermeture, on annule le retour
    cancelAnimationFrame(restoreFrame.current);
    if (returnTo.current === undefined) {
      const previous = document.activeElement;
      returnTo.current = previous instanceof HTMLElement && previous !== document.body ? previous : null;
    }
    return () => {
      // La page est retirée juste après : on rend le focus au tour suivant
      restoreFrame.current = requestAnimationFrame(() => {
        const target = returnTo.current;
        if (target?.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [tv]);

  useEffect(() => {
    const root = rootRef.current;
    if (!tv || !ready || !root || focusedKey.current === contentKey) return;

    // Pendant l'animation d'entrée, le bouton peut encore refuser le focus (sans erreur) :
    // on réessaie à chaque image jusqu'à ce qu'il le prenne, une seconde au plus
    let frame = 0;
    let attempts = 0;
    // Pendant l'arrivée, un autre élément (page précédente retirée, animation) peut faire perdre le
    // focus : sans lui, il faudrait un premier appui sur une flèche avant de pouvoir valider
    let guarded = 0;
    const guard = (target: HTMLElement) => {
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if ((!active || active === document.body) && target.isConnected) {
          target.focus({ preventScroll: true });
        }
        if (++guarded < GUARD_FRAMES) guard(target);
      });
    };
    const attempt = () => {
      for (const selector of initialSelectors) {
        const target = root.querySelector<HTMLElement>(selector);
        if (!target) continue;
        target.focus({ preventScroll: true });
        if (document.activeElement === target) {
          focusedKey.current = contentKey;
          guard(target);
          return;
        }
        break;
      }
      if (++attempts < MAX_FOCUS_ATTEMPTS) frame = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(frame);
    // initialSelectors change de contenu à chaque rendu : la clé suffit à éviter les répétitions
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialSelectors est un nouveau tableau à chaque rendu ; contentKey suffit
  }, [tv, ready, contentKey, rootRef]);
}
