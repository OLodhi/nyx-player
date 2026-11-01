/**
 * piconCache : cache des logos de chaînes (mémoire synchrone + persistance SQLite).
 * Le cache mémoire est un singleton de module : chaque test importe une copie neuve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockDb = {
  select: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>(),
  execute: vi.fn<(sql: string, params?: unknown[]) => Promise<void>>(),
};
vi.mock('../dbCore', () => ({ getDatabase: vi.fn(() => Promise.resolve(mockDb)) }));

const NOW_MS = Date.UTC(2026, 9, 1, 12, 0, 0);
const DAY_MS = 24 * 3600 * 1000;

async function load() {
  vi.resetModules();
  return import('../piconCache');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  mockDb.select.mockResolvedValue([]);
  mockDb.execute.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('piconCache - lecture', () => {
  it('renvoie undefined pour une chaîne jamais vue', async () => {
    const { getCachedPicon } = await load();
    expect(getCachedPicon('tf1')).toBeUndefined();
  });

  it('renvoie l\'adresse juste après l\'écriture (synchrone)', async () => {
    const { cachePicon, getCachedPicon } = await load();
    cachePicon('tf1', 'http://exemple.test/tf1.png');
    expect(getCachedPicon('tf1')).toBe('http://exemple.test/tf1.png');
  });

  it('distingue « vérifié mais absent » (null) de « jamais vu » (undefined)', async () => {
    const { cachePicon, getCachedPicon } = await load();
    cachePicon('inconnue', null);
    expect(getCachedPicon('inconnue')).toBeNull();
    expect(getCachedPicon('autre')).toBeUndefined();
  });

  it('garde l\'entrée jusqu\'à 7 jours puis l\'expire et la supprime', async () => {
    const { cachePicon, getCachedPicon } = await load();
    cachePicon('tf1', 'http://exemple.test/tf1.png');
    vi.setSystemTime(NOW_MS + 7 * DAY_MS);
    expect(getCachedPicon('tf1')).toBe('http://exemple.test/tf1.png');
    vi.setSystemTime(NOW_MS + 7 * DAY_MS + 1);
    expect(getCachedPicon('tf1')).toBeUndefined();
    // Déjà supprimée : un retour dans le passé ne la ressuscite pas
    vi.setSystemTime(NOW_MS);
    expect(getCachedPicon('tf1')).toBeUndefined();
  });
});

describe('piconCache - écriture SQLite', () => {
  it('persiste l\'entrée avec un upsert sur la clé de chaîne', async () => {
    const { cachePicon } = await load();
    cachePicon('tf1', 'http://exemple.test/tf1.png');
    await vi.advanceTimersByTimeAsync(0);
    const [sql, params] = mockDb.execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO picon_cache');
    expect(sql).toContain('ON CONFLICT(channel_key)');
    expect(params).toEqual(['tf1', 'http://exemple.test/tf1.png', NOW_MS]);
  });

  it('persiste un picon absent avec une adresse null', async () => {
    const { cachePicon } = await load();
    cachePicon('x', null);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDb.execute.mock.calls[0][1]).toEqual(['x', null, NOW_MS]);
  });

  it('garde la valeur en mémoire si l\'écriture SQLite échoue', async () => {
    mockDb.execute.mockRejectedValue(new Error('disque plein'));
    const { cachePicon, getCachedPicon } = await load();
    cachePicon('tf1', 'http://exemple.test/tf1.png');
    await vi.advanceTimersByTimeAsync(0);
    expect(getCachedPicon('tf1')).toBe('http://exemple.test/tf1.png');
  });
});

describe('piconCache - initPiconCache', () => {
  it('purge ce qui a plus de 7 jours puis charge le reste en mémoire', async () => {
    mockDb.select.mockResolvedValueOnce([
      { channel_key: 'tf1', url: 'http://exemple.test/tf1.png', updated_at: NOW_MS - DAY_MS },
      { channel_key: 'abs', url: null, updated_at: NOW_MS - DAY_MS },
    ]);
    const { initPiconCache, getCachedPicon } = await load();
    await initPiconCache();
    expect(mockDb.execute).toHaveBeenCalledWith(
      'DELETE FROM picon_cache WHERE updated_at < ?',
      [NOW_MS - 7 * DAY_MS]
    );
    expect(getCachedPicon('tf1')).toBe('http://exemple.test/tf1.png');
    expect(getCachedPicon('abs')).toBeNull();
  });

  it('une ligne déjà périmée côté mémoire est ignorée à la lecture', async () => {
    mockDb.select.mockResolvedValueOnce([
      { channel_key: 'vieille', url: 'http://exemple.test/v.png', updated_at: NOW_MS - 8 * DAY_MS },
    ]);
    const { initPiconCache, getCachedPicon } = await load();
    await initPiconCache();
    expect(getCachedPicon('vieille')).toBeUndefined();
  });

  it('ne lève pas d\'erreur et laisse le cache vide si la base échoue', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('KO'));
    const { initPiconCache, getCachedPicon } = await load();
    await expect(initPiconCache()).resolves.toBeUndefined();
    expect(getCachedPicon('tf1')).toBeUndefined();
  });
});
