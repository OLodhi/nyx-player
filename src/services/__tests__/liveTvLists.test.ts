/**
 * liveTvLists — listes de Live TV construites une fois par catalogue (le lecteur les
 * réutilise au lieu de reconstruire toutes les chaînes à chaque changement de chaîne).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LightIndexes } from '../../types/lightIndex';

const hidden = new Set<string>();
vi.mock('../hiddenCategoriesService', () => ({
  isHidden: (id: string, type: string) => hidden.has(`${id}::${type}`),
}));

import { liveTvLists, visibleLiveCategories } from '../liveTvLists';

function makeIndexes(): LightIndexes {
  return {
    movies: new Map(),
    series: new Map(),
    live: new Map([
      [1, { id: 1, name: 'TF1', iconPrefixId: 0, iconSuffix: 'tf1.png', categoryId: '10', epgChannelId: 'tf1.fr' }],
      [2, { id: 2, name: 'France 2', iconPrefixId: 0, iconSuffix: 'f2.png', categoryId: '11' }],
    ]),
    categories: new Map([
      ['10', { id: '10', name: 'Généralistes', type: 'live' as const }],
      ['11', { id: '11', name: 'Service public', type: 'live' as const }],
      ['20', { id: '20', name: 'Films', type: 'movie' as const }],
    ]),
    moviesByTmdb: new Map(),
    seriesByTmdb: new Map(),
    iconPrefixes: ['http://provider.test/logos/'],
  };
}

describe('liveTvLists', () => {
  beforeEach(() => hidden.clear());

  it('construit les chaînes et les catégories live du catalogue', () => {
    const lists = liveTvLists(makeIndexes());
    expect(lists.categories.map(c => c.category_id)).toEqual(['10', '11']);
    expect(lists.streams).toHaveLength(2);
    expect(lists.streams[0]).toMatchObject({
      stream_id: 1,
      name: 'TF1',
      stream_type: 'live',
      category_id: '10',
      epg_channel_id: 'tf1.fr',
      stream_icon: 'http://provider.test/logos/tf1.png',
    });
  });

  it('rend les mêmes listes pour le même catalogue (rien reconstruit au zap)', () => {
    const indexes = makeIndexes();
    const first = liveTvLists(indexes);
    expect(liveTvLists(indexes)).toBe(first);
    expect(liveTvLists(indexes).streams).toBe(first.streams);
  });

  it('un catalogue actualisé reçoit ses propres listes', () => {
    expect(liveTvLists(makeIndexes())).not.toBe(liveTvLists(makeIndexes()));
  });

  it('visibleLiveCategories écarte les catégories masquées', () => {
    const indexes = makeIndexes();
    expect(visibleLiveCategories(indexes).map(c => c.category_id)).toEqual(['10', '11']);
    hidden.add('11::live');
    expect(visibleLiveCategories(indexes).map(c => c.category_id)).toEqual(['10']);
    // Le cache complet garde toutes les catégories
    expect(liveTvLists(indexes).categories).toHaveLength(2);
  });
});
