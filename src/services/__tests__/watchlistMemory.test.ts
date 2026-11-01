/**
 * « Ma liste » en mémoire : une lecture de la base pour
 * toutes les cartes, rechargée après tout changement. Numéros de source et numéros TMDB ne sont
 * jamais comparés entre eux.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = [
  { stream_id: 101, tmdb_id: 550, type: 'movie' },
  { stream_id: 202, tmdb_id: 0, type: 'series' },
];

const makeDb = () => ({
  select: vi.fn(() => Promise.resolve([...rows])),
  execute: vi.fn(() => Promise.resolve()),
});

let currentDb = makeDb();
let dbFile: string | null = 'nyxplayer_a.db';

vi.mock('../dbCore', () => ({
  getDatabase: vi.fn(() => Promise.resolve(currentDb)),
  getDatabaseFileName: vi.fn(() => dbFile),
}));

vi.mock('../syncService', () => ({
  pushWatchlistUpsertToCloud: vi.fn(),
  pushWatchlistDeleteToCloud: vi.fn(),
}));

import { isInWatchlist, toggleWatchlist, invalidateWatchlistCache, removeFromWatchlist, rememberShownWatchlist, getShownWatchlist } from '../watchlistHydration';
import type { HydratedWatchlistItem } from '../watchlistHydration';
import type { LightIndexes } from '../../types/lightIndex';
import { WATCHLIST_EVENT } from '../eventConstants';

describe('watchlistHydration — « Ma liste » en mémoire', () => {
  beforeEach(() => {
    currentDb = makeDb();
    invalidateWatchlistCache();
  });

  it('une seule lecture de la base pour plusieurs cartes', async () => {
    await Promise.all([
      isInWatchlist(101, 0, 'movie'),
      isInWatchlist(0, 550, 'movie'),
      isInWatchlist(999, 0, 'movie'),
      isInWatchlist(202, 0, 'series'),
    ]);
    expect(currentDb.select).toHaveBeenCalledTimes(1);
  });

  it('par le numéro TMDB s\'il y en a un, sinon par le numéro de source, et le même type', async () => {
    expect(await isInWatchlist(101, 0, 'movie')).toBe(true); // par stream_id
    expect(await isInWatchlist(0, 550, 'movie')).toBe(true); // par tmdb_id
    expect(await isInWatchlist(777, 550, 'movie')).toBe(true); // même titre TMDB, autre source
    expect(await isInWatchlist(0, 550, 'series')).toBe(false); // autre type
    expect(await isInWatchlist(202, 0, 'series')).toBe(true);
    expect(await isInWatchlist(999, 0, 'movie')).toBe(false);
    expect(await isInWatchlist(0, 0, 'movie')).toBe(false); // aucun numéro
  });

  it('un numéro de source égal au numéro TMDB d\'un autre film ne le met pas dans Ma liste', async () => {
    // Ma liste : source 101 (TMDB 550). Fiche d'un autre film dont le numéro TMDB est 101.
    expect(await isInWatchlist(0, 101, 'movie')).toBe(false);
    expect(await isInWatchlist(4242, 101, 'movie')).toBe(false);
    // Et l'inverse : une source 550 sans TMDB n'est pas le film TMDB 550 de Ma liste
    expect(await isInWatchlist(550, 0, 'movie')).toBe(false);
  });

  it('ce film peut donc être ajouté (l\'ajout n\'est plus pris pour un retrait)', async () => {
    const added = await toggleWatchlist(4242, 101, 'movie');
    expect(added).toBe(true);
    expect(currentDb.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO watchlist'),
      expect.arrayContaining([4242, 101, 'movie']),
    );
  });

  it('un changement signalé (WATCHLIST_EVENT) fait relire la base', async () => {
    await isInWatchlist(101, 0, 'movie');
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    await isInWatchlist(101, 0, 'movie');
    expect(currentDb.select).toHaveBeenCalledTimes(2);
  });

  it('un retrait est vu aussitôt par les cartes', async () => {
    expect(await isInWatchlist(0, 550, 'movie')).toBe(true);
    currentDb.select.mockImplementation(() => Promise.resolve([rows[1]]));
    await removeFromWatchlist(101, 550, 'movie');
    expect(await isInWatchlist(0, 550, 'movie')).toBe(false);
  });

  it('une autre connexion (changement de compte, réouverture) fait relire la base', async () => {
    await isInWatchlist(101, 0, 'movie');
    const first = currentDb;
    currentDb = makeDb();
    currentDb.select.mockImplementation(() => Promise.resolve([]));
    expect(await isInWatchlist(101, 0, 'movie')).toBe(false);
    expect(first.select).toHaveBeenCalledTimes(1);
    expect(currentDb.select).toHaveBeenCalledTimes(1);
  });

  it('une lecture en échec n\'est pas gardée en mémoire', async () => {
    currentDb.select.mockImplementationOnce(() => Promise.reject(new Error('base indisponible')));
    await expect(isInWatchlist(101, 0, 'movie')).rejects.toThrow('base indisponible');
    expect(await isInWatchlist(101, 0, 'movie')).toBe(true);
  });
});

describe('watchlistHydration — dernière « Ma liste » affichée (arrivée sans cartes fantômes)', () => {
  const indexes = {} as LightIndexes;
  const items = [{ stream_id: 101, tmdb_id: 550, type: 'movie', added_at: 1, name: 'Film', posterUrl: '', isOrphan: false }] as HydratedWatchlistItem[];
  const progress = new Map();

  beforeEach(() => {
    dbFile = 'nyxplayer_a.db';
    invalidateWatchlistCache();
  });

  it('rendue telle quelle à la visite suivante', () => {
    expect(getShownWatchlist(indexes)).toBeNull();
    rememberShownWatchlist(indexes, { items, progress });
    expect(getShownWatchlist(indexes)).toEqual({ items, progress });
  });

  it('rien pour un autre compte ou un autre catalogue', () => {
    rememberShownWatchlist(indexes, { items, progress });
    expect(getShownWatchlist({} as LightIndexes)).toBeNull();
    dbFile = 'nyxplayer_b.db';
    expect(getShownWatchlist(indexes)).toBeNull();
  });

  it('oubliée après un changement de la liste (ajout, retrait)', () => {
    rememberShownWatchlist(indexes, { items, progress });
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    expect(getShownWatchlist(indexes)).toBeNull();
  });
});
