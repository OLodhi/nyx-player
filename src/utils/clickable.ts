/**
 * clickable.ts — Rendre activable au clavier et à la télécommande un élément non natif.
 *
 * Certaines cartes (affiches, chaînes) sont des `div` avec un `onClick` : à la souris et au doigt
 * cela suffit, mais elles sont alors invisibles pour la navigation d'Android TV, qui ne se déplace
 * qu'entre éléments focusables. Ce helper ajoute le rôle, l'entrée dans l'ordre de focus et la
 * validation par Entrée / OK — sans changer la structure ni le style existants.
 */

import type React from 'react';

export interface ClickableProps {
  role: 'button';
  tabIndex: 0;
  onKeyDown: (event: React.KeyboardEvent) => void;
}

export function clickableProps(onActivate: () => void): ClickableProps {
  return {
    role: 'button',
    tabIndex: 0,
    onKeyDown: (event: React.KeyboardEvent) => {
      // La touche OK de la télécommande arrive comme « Enter » ; Espace pour le clavier
      if (event.key !== 'Enter' && event.key !== ' ') return;
      // Un enfant focusable (bouton favori…) gère déjà sa propre validation
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      onActivate();
    },
  };
}
