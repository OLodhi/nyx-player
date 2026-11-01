/**
 * Recherche : même règle que FTS5 pour le filtrage immédiat,
 * vraie recherche 300 ms après la dernière lettre, résultats affichés filtrés aussitôt entre-temps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { LightIndexes, LightMovie } from '../../types/lightIndex';

const searchContent = vi.fn();

vi.mock('../../services/searchIndex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/searchIndex')>();
  return { ...actual, searchContent: (...args: unknown[]) => searchContent(...args) };
});
vi.mock('../../services/dbCore', () => ({ getDatabase: vi.fn() }));

import { matchesSearch } from '../../services/searchIndex';
import { useGlobalSearch } from '../useGlobalSearch';

const movie = (id: number, name: string, tmdbId: number): LightMovie => ({
  id, name, tmdbId, iconPrefixId: 0, iconSuffix: '', categoryId: '1', added: 0, containerExt: 'mp4',
});

const catalog = [movie(1, 'The Matrix', 603), movie(2, 'The Mask', 854), movie(3, 'The Batman', 414906)];

const indexes = {
  movies: new Map(catalog.map((m) => [m.id, m])),
  series: new Map(),
  live: new Map(),
  iconPrefixes: [],
} as unknown as LightIndexes;

describe('matchesSearch — même règle que FTS5 (mot1* mot2*)', () => {
  it('chaque mot tapé commence un mot du nom, dans n\'importe quel ordre', () => {
    expect(matchesSearch('The Matrix', 'the ma')).toBe(true);
    expect(matchesSearch('The Matrix', 'matrix the')).toBe(true);
    expect(matchesSearch('The Matrix', 'atrix')).toBe(false);
    expect(matchesSearch('The Batman', 'the ma')).toBe(false);
  });

  it('accents, majuscules et ponctuation ignorés', () => {
    expect(matchesSearch('Amélie Poulain', 'AMELIE')).toBe(true);
    expect(matchesSearch('Spider-Man', 'spiderman')).toBe(true);
  });

  it('requête vide : aucun résultat', () => {
    expect(matchesSearch('The Matrix', '  ')).toBe(false);
  });
});

describe('useGlobalSearch — attente et filtrage immédiat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchContent.mockReset();
    searchContent.mockImplementation(async (q: string) =>
      catalog.filter((m) => matchesSearch(m.name, q)).map((m) => ({ id: m.id, name: m.name, type: 'movie' })));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('la vraie recherche part 300 ms après la dernière lettre', async () => {
    const { rerender } = renderHook(({ q }) => useGlobalSearch(indexes, q), { initialProps: { q: '' } });
    rerender({ q: 'th' });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    rerender({ q: 'the' });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(searchContent).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(searchContent).toHaveBeenCalledTimes(1);
    expect(searchContent).toHaveBeenCalledWith('the', 500);
  });

  it('une lettre de plus filtre aussitôt les résultats affichés, avant la recherche', async () => {
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(indexes, q), { initialProps: { q: 'the' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(result.current.results.movies).toHaveLength(3);

    rerender({ q: 'the ma' });
    // Pas encore de nouvelle recherche, mais l'affichage suit déjà la frappe
    expect(searchContent).toHaveBeenCalledTimes(1);
    expect(result.current.results.movies.map((g) => g.representative.name).sort()).toEqual(['The Mask', 'The Matrix']);
    expect(result.current.debouncedQuery).toBe('the ma');

    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(searchContent).toHaveBeenCalledTimes(2);
    expect(result.current.results.movies).toHaveLength(2);
  });

  it('une lettre effacée : pas de filtrage, les résultats restent jusqu\'à la recherche', async () => {
    const { result, rerender } = renderHook(({ q }) => useGlobalSearch(indexes, q), { initialProps: { q: 'the ma' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    rerender({ q: 'the m' });
    expect(result.current.results.movies).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    expect(result.current.results.movies).toHaveLength(2);
  });
});
