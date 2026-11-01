/**
 * useTvArrivalFocus — Focus à l'arrivée sur une page de la barre latérale, à la télécommande.
 *
 * Règle : à l'arrivée sur une page, la sélection est sur l'icône de
 * cette page dans la barre latérale. Le changement de page prend un moment : on reste sur la barre,
 * et Droite entre dans la page. Avant, à l'ouverture de l'app (après le choix du profil, ou sur la
 * page de démarrage choisie dans les réglages) et après un changement de page venu d'ailleurs que la
 * barre (Retour, lien d'une page), rien n'était sélectionné : c'était la première flèche qui décidait.
 *
 * La règle ne prend pas la main sur une page qui pose elle-même son focus (champ de la Recherche) :
 * elle n'agit que si rien n'est sélectionné, ou si la sélection est déjà dans la barre latérale
 * (sur l'icône quittée, après un Retour).
 *
 * Hors TV, le hook ne fait rien.
 */

import { useEffect } from 'react';
import { isTv } from '../utils/platform';
import { focusActiveSidebarEntry, zoneOf } from '../utils/spatialNavigation';

/** Rien n'est sélectionné (un élément retiré de la page rend le focus au corps du document). */
function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/** @param page page courante : chaque arrivée sur une page replace la sélection */
export function useTvArrivalFocus(page: string): void {
  useEffect(() => {
    if (!isTv()) return;
    // Au tour suivant : la page quittée est retirée, celle d'arrivée a posé son propre focus
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (focusLost() || (active instanceof HTMLElement && zoneOf(active) === 'sidebar')) {
        focusActiveSidebarEntry();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
}
