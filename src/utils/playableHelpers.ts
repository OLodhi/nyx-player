/**
 * Helpers pour extraire des infos d'un PlayableItem (union type).
 * Utilisés par App.tsx pour afficher le player et PlayerControls.
 */
import type { TFunction } from 'i18next';
import type { PlayableItem } from '../types/player';

/** Extrait le titre affichable d'un PlayableItem. */
export function getPlayableTitle(item: PlayableItem, t: TFunction): string {
  if ('title' in item && item.title) return item.title;
  if ('name' in item && item.name) return item.name;
  return t('playing_now');
}

/** Extrait un identifiant unique d'un PlayableItem. */
export function getPlayableId(item: PlayableItem): string {
  if ('stream_id' in item && item.stream_id) return String(item.stream_id);
  if ('id' in item && item.id) return String(item.id);
  if ('name' in item && item.name) return item.name;
  return 'unknown';
}

/**
 * Extrait le TMDB ID d'un PlayableItem.
 * Pour les films : utilise XtreamMovie.tmdb
 * Pour les séries : le caller doit utiliser seriesTmdbId directement (depuis currentSeries)
 */
export function getPlayableTmdbId(item: PlayableItem): number | undefined {
  if ('tmdb' in item && item.tmdb) {
    const num = Number(item.tmdb);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}
