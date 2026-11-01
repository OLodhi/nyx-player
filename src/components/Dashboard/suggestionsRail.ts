/**
 * Rangées de l'accueil Suggestions sur le rail TV (components/Iptv/rail) : la liste des rangées, dans l'ordre et avec
 * les règles d'affichage des rangées React de DashboardPage (rangée masquée par les préférences, rangée vide absente,
 * rangée en chargement grise), et la source du rail, qui garde l'objet d'une rangée tant qu'elle ne change pas.
 */

import { useMemo, useState } from 'react';
import type { CarouselItem } from '../Lists/CarouselCard';
import type { RailSource } from '../Iptv/rail/rail';
import { createRailRowCache } from '../Iptv/rail/railRowCache';

/** Une rangée de Suggestions */
export interface SuggestionRow {
  /** Clé de la rangée dans le rail (unique, stable d'une version à l'autre) */
  key: string;
  title: string;
  items: CarouselItem[];
  /** Données encore en chargement : rangée grise tant qu'elle n'a pas de cartes */
  loading: boolean;
}

/** Cartes des rangées, déjà construites (et gardées d'un rendu à l'autre) par la page */
export interface SuggestionsContent {
  trending: CarouselItem[];
  continueWatching: CarouselItem[];
  nowPlaying: CarouselItem[];
  onTheAir: CarouselItem[];
  watchlist: CarouselItem[];
  topRated: CarouselItem[];
  popular: CarouselItem[];
  genres: ReadonlyArray<readonly [number, CarouselItem[]]>;
  thisWeekMovies: CarouselItem[];
  thisWeekSeries: CarouselItem[];
}

export interface SuggestionsTitles {
  trending: string;
  continueWatching: string;
  nowPlaying: string;
  onTheAir: string;
  watchlist: string;
  topRated: string;
  popular: string;
  genre: (genreId: number) => string;
  thisWeekMovies: string;
  thisWeekSeries: string;
}

/**
 * Rangées de Suggestions, dans l'ordre de l'accueil. `disabled` : rangées masquées par les préférences ; `loading` :
 * bannière et listes TMDB en chargement (Tendances, Films récents, Séries récentes, Top, Populaires restent alors
 * affichées, grises, tant qu'elles n'ont pas de cartes).
 */
export function suggestionRows(
  content: SuggestionsContent,
  titles: SuggestionsTitles,
  disabled: readonly string[],
  loading: boolean,
): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  const add = (key: string, title: string, items: CarouselItem[], waits = false) => {
    if (disabled.includes(key)) return;
    // Rangée vide : absente, sauf pendant le chargement de ses données
    if (items.length === 0 && !(waits && loading)) return;
    rows.push({ key, title, items, loading: waits && loading && items.length === 0 });
  };
  add('trending', titles.trending, content.trending, true);
  add('continue', titles.continueWatching, content.continueWatching);
  add('nowPlaying', titles.nowPlaying, content.nowPlaying, true);
  add('onTheAir', titles.onTheAir, content.onTheAir, true);
  add('watchlist', titles.watchlist, content.watchlist);
  add('topRated', titles.topRated, content.topRated, true);
  add('popular', titles.popular, content.popular, true);
  // Les genres ne se masquent pas un à un
  for (const [genreId, items] of content.genres) {
    if (items.length > 0) rows.push({ key: `genre-${genreId}`, title: titles.genre(genreId), items, loading: false });
  }
  add('thisWeekMovies', titles.thisWeekMovies, content.thisWeekMovies);
  add('thisWeekSeries', titles.thisWeekSeries, content.thisWeekSeries);
  return rows;
}

/**
 * Clés et source du rail pour ces rangées. Les clés gardent leur identité tant que la liste ne change pas, et une
 * rangée dont titre, cartes et état n'ont pas changé garde ses données : le rail ne remplit de nouveau que les rangées
 * qui ont changé (un titre ajouté à Ma liste ne reconstruit que Ma liste).
 */
export function useSuggestionsRail(rows: SuggestionRow[], watchlistLabel: string): { keys: readonly string[]; source: RailSource } {
  const joined = rows.map((row) => row.key).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- la liste des clés ne change que si `joined` change
  const keys = useMemo(() => rows.map((row) => row.key), [joined]);
  const [cache] = useState(createRailRowCache);
  const source = useMemo((): RailSource => {
    const byKey = new Map(rows.map((row) => [row.key, row]));
    return (key) => {
      const row = byKey.get(key);
      if (!row) return null;
      return cache.get(key, [row.title, row.items, row.loading, watchlistLabel], () => ({
        title: row.title,
        items: row.items,
        watchlistLabel,
        loading: row.loading,
      }));
    };
  }, [rows, watchlistLabel, cache]);
  return { keys, source };
}
