import { describe, it, expect } from 'vitest';
import { groupByTmdbId } from '../movieGrouping';

describe('movieGrouping', () => {
  describe('groupByTmdbId', () => {
    it('groupe les items par tmdb id', () => {
      const items = [
        { stream_id: 1, name: 'Movie A', tmdb: 123 },
        { stream_id: 2, name: 'Movie A 4K', tmdb: 123 },
        { stream_id: 3, name: 'Movie B', tmdb: 456 },
      ];

      const groups = groupByTmdbId(items);

      expect(groups).toHaveLength(2);
      expect(groups.find((g) => g.groupKey === 'tmdb_123')?.sourceCount).toBe(2);
      expect(groups.find((g) => g.groupKey === 'tmdb_456')?.sourceCount).toBe(1);
    });

    it('gère les tmdb id en string', () => {
      const items = [
        { stream_id: 1, name: 'Movie A', tmdb: '123' },
        { stream_id: 2, name: 'Movie A 4K', tmdb: '123' },
      ];

      const groups = groupByTmdbId(items);

      expect(groups).toHaveLength(1);
      expect(groups[0].sourceCount).toBe(2);
    });

    it('exclut les items sans tmdb valide', () => {
      const items = [
        { stream_id: 1, name: 'Movie A', tmdb: 0 },
        { stream_id: 2, name: 'Movie B', tmdb: undefined },
        { stream_id: 3, name: 'Movie C', tmdb: 123 },
      ];

      const groups = groupByTmdbId(items);

      expect(groups).toHaveLength(1);
      expect(groups[0].representative.name).toBe('Movie C');
    });

    it('retourne un tableau vide pour un input vide', () => {
      expect(groupByTmdbId([])).toEqual([]);
    });
  });
});
