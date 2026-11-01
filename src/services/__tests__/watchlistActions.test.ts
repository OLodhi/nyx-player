/**
 * Bouton « Ma liste » : en cas d'échec, message bref et état réel relu dans la base, pour que
 * le bouton ne mente pas (une écriture partielle a pu passer).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../watchlistHydration', () => ({ toggleWatchlist: vi.fn(), isInWatchlist: vi.fn() }));

import { isInWatchlist, toggleWatchlist } from '../watchlistHydration';
import { toggleWatchlistOrNotify } from '../watchlistActions';
import { APP_NOTICE_EVENT } from '../../utils/appNotice';

const notices: string[] = [];
const listen = (e: Event) => notices.push((e as CustomEvent<string>).detail);

beforeEach(() => {
  notices.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener(APP_NOTICE_EVENT, listen);
});
afterEach(() => {
  window.removeEventListener(APP_NOTICE_EVENT, listen);
  vi.restoreAllMocks();
});

describe('toggleWatchlistOrNotify', () => {
  it('réussite : nouvel état, pas de message', async () => {
    vi.mocked(toggleWatchlist).mockResolvedValueOnce(true);
    await expect(toggleWatchlistOrNotify(1, 42, 'movie')).resolves.toBe(true);
    expect(notices).toEqual([]);
  });

  it('échec : message bref et état relu dans la base', async () => {
    vi.mocked(toggleWatchlist).mockRejectedValueOnce(new Error('database is locked'));
    vi.mocked(isInWatchlist).mockResolvedValueOnce(true);
    await expect(toggleWatchlistOrNotify(1, 42, 'movie')).resolves.toBe(true);
    expect(notices).toEqual(['watchlist_update_failed']);
  });

  it('échec et base illisible : message bref, état inchangé (null)', async () => {
    vi.mocked(toggleWatchlist).mockRejectedValueOnce(new Error('database is locked'));
    vi.mocked(isInWatchlist).mockRejectedValueOnce(new Error('database is locked'));
    await expect(toggleWatchlistOrNotify(1, 42, 'movie')).resolves.toBeNull();
    expect(notices).toEqual(['watchlist_update_failed']);
  });
});
