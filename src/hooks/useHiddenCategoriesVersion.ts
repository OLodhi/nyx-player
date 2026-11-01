/**
 * useHiddenCategoriesVersion.ts — Version tracker pour les catégories masquées
 *
 * Écoute l'event 'hiddenCategoriesUpdated' et incrémente un compteur.
 * Utilisé comme dépendance de useMemo pour invalider les listes filtrées
 * quand le sync cloud modifie les catégories masquées.
 *
 * Pattern identique à langVersion dans useDashboardData.ts.
 */

import { useState, useEffect } from 'react';
import { HIDDEN_CATEGORIES_EVENT } from '../services/eventConstants';

export function useHiddenCategoriesVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const handler = () => setVersion((v) => v + 1);
    window.addEventListener(HIDDEN_CATEGORIES_EVENT, handler);
    return () => window.removeEventListener(HIDDEN_CATEGORIES_EVENT, handler);
  }, []);

  return version;
}
