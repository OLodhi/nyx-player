/**
 * Rangées de Suggestions sur le rail TV : mêmes rangées, même ordre et mêmes règles que les rangées React de l'accueil,
 * et une source qui ne change l'objet d'une rangée que si la rangée a changé.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CarouselItem } from '../../Lists/CarouselCard';
import { suggestionRows, useSuggestionsRail, type SuggestionsContent, type SuggestionsTitles } from '../suggestionsRail';

const cards = (name: string, count = 2): CarouselItem[] => Array.from({ length: count }, (_, i) => ({ id: `${name}-${i}`, title: `${name} ${i}`, image: '' }));

const full = (): SuggestionsContent => ({
  trending: cards('trending'),
  continueWatching: cards('continue'),
  nowPlaying: cards('nowPlaying'),
  onTheAir: cards('onTheAir'),
  watchlist: cards('watchlist'),
  topRated: cards('topRated'),
  popular: cards('popular'),
  genres: [[28, cards('action')], [35, cards('comedy')]],
  thisWeekMovies: cards('thisWeekMovies'),
  thisWeekSeries: cards('thisWeekSeries'),
});

const titles: SuggestionsTitles = {
  trending: 'Tendances',
  continueWatching: 'Reprendre',
  nowPlaying: 'Films récents',
  onTheAir: 'Séries récentes',
  watchlist: 'Ma liste',
  topRated: 'Top',
  popular: 'Populaires',
  genre: (id) => `Genre ${id}`,
  thisWeekMovies: 'Films de la semaine',
  thisWeekSeries: 'Séries de la semaine',
};

const ALL = ['trending', 'continue', 'nowPlaying', 'onTheAir', 'watchlist', 'topRated', 'popular', 'genre-28', 'genre-35', 'thisWeekMovies', 'thisWeekSeries'];
const keysOf = (content: SuggestionsContent, disabled: string[] = [], loading = false) => suggestionRows(content, titles, disabled, loading).map((row) => row.key);

describe('rangées de Suggestions', () => {
  it('toutes les rangées, dans l\'ordre de l\'accueil, avec leur titre et leurs cartes', () => {
    const content = full();
    const rows = suggestionRows(content, titles, [], false);
    expect(rows.map((row) => row.key)).toEqual(ALL);
    expect(rows.map((row) => row.title)).toEqual([
      'Tendances', 'Reprendre', 'Films récents', 'Séries récentes', 'Ma liste', 'Top', 'Populaires', 'Genre 28', 'Genre 35',
      'Films de la semaine', 'Séries de la semaine',
    ]);
    expect(rows[1].items).toBe(content.continueWatching);
    expect(rows.every((row) => !row.loading)).toBe(true);
  });

  it.each(['trending', 'continue', 'nowPlaying', 'onTheAir', 'watchlist', 'topRated', 'popular', 'thisWeekMovies', 'thisWeekSeries'])(
    'masquée par les préférences : « %s » disparaît, l\'ordre des autres ne change pas',
    (key) => {
      expect(keysOf(full(), [key])).toEqual(ALL.filter((other) => other !== key));
    },
  );

  it('les genres ne se masquent pas un à un', () => {
    expect(keysOf(full(), ['genre-28', '28'])).toEqual(ALL);
  });

  it('rangée vide absente : Reprendre, Ma liste, un genre, les nouveautés', () => {
    const content: SuggestionsContent = {
      ...full(),
      continueWatching: [],
      watchlist: [],
      genres: [[28, []], [35, cards('comedy')]],
      thisWeekMovies: [],
      thisWeekSeries: [],
    };
    expect(keysOf(content)).toEqual(['trending', 'nowPlaying', 'onTheAir', 'topRated', 'popular', 'genre-35']);
  });

  it('en chargement : les rangées TMDB vides attendent, grises ; une rangée qui a déjà ses cartes les montre', () => {
    const content: SuggestionsContent = {
      ...full(),
      trending: cards('trending'),
      nowPlaying: [],
      onTheAir: [],
      topRated: [],
      popular: [],
      continueWatching: [],
      watchlist: [],
      genres: [],
      thisWeekMovies: [],
      thisWeekSeries: [],
    };
    const rows = suggestionRows(content, titles, [], true);
    expect(rows.map((row) => [row.key, row.loading])).toEqual([
      ['trending', false],
      ['nowPlaying', true],
      ['onTheAir', true],
      ['topRated', true],
      ['popular', true],
    ]);
    // Chargement fini, toujours vides : absentes
    expect(keysOf(content, [], false)).toEqual(['trending']);
  });
});

describe('source du rail de Suggestions', () => {
  const render = (content: SuggestionsContent, label = 'Ajouter à ma liste') =>
    renderHook(({ rows, watchlistLabel }) => useSuggestionsRail(rows, watchlistLabel), {
      initialProps: { rows: suggestionRows(content, titles, [], false), watchlistLabel: label },
    });

  it('une rangée inchangée garde ses données d\'une version à l\'autre ; seule celle qui change en reçoit de nouvelles', () => {
    const content = full();
    const { result, rerender } = render(content);
    const first = result.current;
    const trending = first.source('trending');
    const watchlist = first.source('watchlist');
    expect(trending).toEqual({ title: 'Tendances', items: content.trending, watchlistLabel: 'Ajouter à ma liste', loading: false });

    // Un titre ajouté à Ma liste : nouvelle liste de rangées, seule Ma liste a de nouvelles cartes
    const next = { ...content, watchlist: cards('watchlist', 3) };
    rerender({ rows: suggestionRows(next, titles, [], false), watchlistLabel: 'Ajouter à ma liste' });
    expect(result.current.source).not.toBe(first.source);
    expect(result.current.source('trending')).toBe(trending);
    expect(result.current.source('watchlist')).not.toBe(watchlist);
    expect(result.current.source('watchlist')!.items).toBe(next.watchlist);
    // Mêmes rangées : mêmes clés, même tableau
    expect(result.current.keys).toBe(first.keys);
  });

  it('une rangée qui apparaît change les clés ; une rangée inconnue n\'a pas de données', () => {
    const content = { ...full(), watchlist: [] };
    const { result, rerender } = render(content);
    const first = result.current.keys;
    expect(first).not.toContain('watchlist');
    expect(result.current.source('watchlist')).toBeNull();
    rerender({ rows: suggestionRows({ ...content, watchlist: cards('watchlist') }, titles, [], false), watchlistLabel: 'Ajouter à ma liste' });
    expect(result.current.keys).not.toBe(first);
    expect(result.current.keys).toEqual(ALL);
  });

  it('langue changée : toutes les rangées reçoivent de nouvelles données', () => {
    const content = full();
    const { result, rerender } = render(content);
    const trending = result.current.source('trending');
    rerender({ rows: suggestionRows(content, titles, [], false), watchlistLabel: 'Add to my list' });
    expect(result.current.source('trending')).not.toBe(trending);
    expect(result.current.source('trending')!.watchlistLabel).toBe('Add to my list');
  });
});
