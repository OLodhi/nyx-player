/**
 * liveTvLists.ts — Catégories et chaînes de Live TV tirées du catalogue en mémoire.
 *
 * Construites une fois par catalogue (Chromecast) : elles étaient reconstruites à chaque
 * changement de catégorie (toutes les chaînes du fournisseur, ≈ 80 ms plus le nettoyage mémoire sur
 * le Chromecast, pendant l'ouverture de la catégorie), et la page refiltrait tout puisque la liste
 * était neuve. Le lecteur (liste de zap) reprend les mêmes listes au lieu de tout reconstruire à
 * chaque changement de chaîne. Un catalogue actualisé est un nouvel objet (jamais
 * modifié sur place) : il reçoit ses propres listes.
 */

import type { IptvCategory, IptvStream } from '../types/iptv';
import type { LightIndexes } from '../types/lightIndex';
import { getIconUrl } from '../types/lightIndex';
import { isHidden } from './hiddenCategoriesService';

export interface LiveTvLists {
  categories: IptvCategory[];
  streams: IptvStream[];
}

const liveTvCache = new WeakMap<LightIndexes, LiveTvLists>();

/** Toutes les catégories live (masquées comprises) et toutes les chaînes, une fois par catalogue. */
export function liveTvLists(indexes: LightIndexes): LiveTvLists {
  let lists = liveTvCache.get(indexes);
  if (!lists) {
    lists = {
      categories: Array.from(indexes.categories.values())
        .filter(c => c.type === 'live')
        .map(c => ({
          category_id: c.id,
          category_name: c.name,
          parent_id: 0,
        })),
      streams: Array.from(indexes.live.values()).map(ch => ({
        num: 0,
        name: ch.name,
        stream_type: 'live' as const,
        stream_id: ch.id,
        stream_icon: getIconUrl(ch, indexes.iconPrefixes),
        epg_channel_id: ch.epgChannelId,
        matched_epg_id: ch.matchedEpgId,
        match_method: ch.matchMethod,
        added: '',
        category_id: ch.categoryId,
        tmdb: 0,
      })),
    };
    liveTvCache.set(indexes, lists);
  }
  return lists;
}

/**
 * Catégories live non masquées, dans l'ordre du catalogue. Liste courte (quelques centaines au
 * plus) : à recalculer quand les catégories masquées changent (useHiddenCategoriesVersion).
 */
export function visibleLiveCategories(indexes: LightIndexes): IptvCategory[] {
  return liveTvLists(indexes).categories.filter(c => !isHidden(c.category_id, 'live'));
}
