/**
 * progressRelink.ts : le cloud suit les reprises de films re-liées à un nouveau numéro.
 * Plus aucune reprise n'est effacée après une lecture du catalogue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const select = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);
const execute = vi.fn(async (..._args: unknown[]) => ({ rowsAffected: 0 }));
vi.mock('../dbCore', () => ({ getDatabase: async () => ({ select, execute }) }));
const pushDelete = vi.fn();
const pushUpsert = vi.fn();
vi.mock('../syncService', () => ({
  pushPlaybackDeleteToCloud: (...args: unknown[]) => pushDelete(...args),
  pushPlaybackUpsertToCloud: (...args: unknown[]) => pushUpsert(...args),
}));

import { pushRelinkedProgress } from '../progressRelink';

const row = { tmdb_id: 777, title: 'Film', poster_url: null, time_seconds: 60, duration_seconds: 600, container_extension: 'mkv', updated_at: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  select.mockResolvedValue([row]);
});

describe('pushRelinkedProgress', () => {
  it('retire la reprise à l\'ancien numéro du cloud et l\'écrit au nouveau', async () => {
    await pushRelinkedProgress([{ from: 5, to: 51 }], () => true);
    expect(pushDelete).toHaveBeenCalledWith(5);
    expect(pushUpsert).toHaveBeenCalledWith(51, 'movie', expect.objectContaining({ tmdb_id: 777, time_seconds: 60, updated_at: 5 }));
  });

  it('n\'efface jamais rien sur l\'appareil', async () => {
    await pushRelinkedProgress([{ from: 5, to: 51 }], () => true);
    expect(execute).not.toHaveBeenCalled();
  });

  it('autre compte entre-temps : plus rien ne part au cloud', async () => {
    await pushRelinkedProgress([{ from: 5, to: 51 }], () => false);
    expect(pushDelete).not.toHaveBeenCalled();
    expect(pushUpsert).not.toHaveBeenCalled();
  });

  it('sans re-liaison : aucune lecture de la base', async () => {
    await pushRelinkedProgress([], () => true);
    expect(select).not.toHaveBeenCalled();
  });
});
