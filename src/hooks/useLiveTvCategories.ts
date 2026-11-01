/**
 * useLiveTvCategories.ts — State des catégories Live TV
 *
 * Extrait depuis App.tsx (Phase 3B).
 * Gère la catégorie sélectionnée et les catégories épinglées (pin/unpin).
 * Écoute l'event 'liveTvBookmarksUpdated' pour se rafraîchir après un sync cloud.
 */

import { useState, useCallback, useEffect } from 'react';
import { getPinnedCategories, togglePinnedCategory } from '../services/liveTvBookmarksService';
import { LIVE_TV_BOOKMARKS_EVENT } from '../services/eventConstants';

export function useLiveTvCategories() {
  const [selectedCategory, setSelectedCategory] = useState<string>('favorites');
  const [pinnedCategories, setPinnedCategories] = useState<Set<string>>(() => getPinnedCategories());

  // Écouter les mises à jour (toggle local + reload après sync cloud)
  useEffect(() => {
    const handleUpdate = () => {
      setPinnedCategories(getPinnedCategories());
    };

    window.addEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
    return () => window.removeEventListener(LIVE_TV_BOOKMARKS_EVENT, handleUpdate);
  }, []);

  const togglePin = useCallback((categoryId: string) => {
    void togglePinnedCategory(categoryId);
    // Le state sera mis à jour par le listener ci-dessus via l'event dispatché par togglePinnedCategory
  }, []);

  return { selectedCategory, setSelectedCategory, pinnedCategories, togglePin };
}
