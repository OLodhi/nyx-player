/**
 * Tests pour catalogLight.ts : lecture du catalogue au démarrage (commande Rust, secours ligne à ligne).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../dbCore', () => ({ getDatabaseFileName: vi.fn() }));
vi.mock('../movieRepository', () => ({ getAllMovies: vi.fn() }));
vi.mock('../seriesRepository', () => ({ getAllSeries: vi.fn() }));
vi.mock('../liveRepository', () => ({ getAllLive: vi.fn() }));
vi.mock('../categoryRepository', () => ({ getAllCategories: vi.fn() }));
vi.mock('../../utils/lightIndexBuilder', () => ({
  buildLightIndexesFromCatalog: vi.fn(),
  buildLightIndexesFromSQLite: vi.fn(),
  countLightIndexDifferences: vi.fn(),
}));
vi.mock('../../utils/perfMarks', () => ({ perfMark: vi.fn() }));
vi.mock('../../dev/perfHook', () => ({ PERF_ENABLED: false }));

import { invoke } from '@tauri-apps/api/core';
import { getDatabaseFileName } from '../dbCore';
import { getAllMovies } from '../movieRepository';
import { getAllSeries } from '../seriesRepository';
import { getAllLive } from '../liveRepository';
import { getAllCategories } from '../categoryRepository';
import { buildLightIndexesFromCatalog, buildLightIndexesFromSQLite } from '../../utils/lightIndexBuilder';
import { perfMark } from '../../utils/perfMarks';
import { loadLightIndexes, buildIndexesRowByRow } from '../catalogLight';

const fromCatalog = { tag: 'compact' };
const fromRows = { tag: 'rows' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDatabaseFileName).mockReturnValue('nyx-test.db');
  vi.mocked(buildLightIndexesFromCatalog).mockReturnValue(fromCatalog as never);
  vi.mocked(buildLightIndexesFromSQLite).mockReturnValue(fromRows as never);
  vi.mocked(getAllMovies).mockResolvedValue([{ id: 'm' }] as never);
  vi.mocked(getAllSeries).mockResolvedValue([{ id: 's' }] as never);
  vi.mocked(getAllLive).mockResolvedValue([{ id: 'l' }] as never);
  vi.mocked(getAllCategories).mockResolvedValue([{ id: 'c' }] as never);
});

describe('catalogLight - loadLightIndexes', () => {
  it('lit le catalogue compact via la commande Rust avec le nom de la base', async () => {
    const catalog = { movies: [] };
    vi.mocked(invoke).mockResolvedValueOnce(catalog);
    const result = await loadLightIndexes();
    expect(invoke).toHaveBeenCalledWith('load_light_catalog', { dbName: 'nyx-test.db' });
    expect(buildLightIndexesFromCatalog).toHaveBeenCalledWith(catalog);
    expect(result).toBe(fromCatalog);
    expect(getAllMovies).not.toHaveBeenCalled();
  });

  it('pose les repères de mesure de la lecture compacte', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({});
    await loadLightIndexes();
    expect(vi.mocked(perfMark).mock.calls.map(c => c[0])).toEqual([
      'catalog-read-start', 'catalog-read-end', 'catalog-indexed',
    ]);
  });

  it('se rabat sur la lecture ligne à ligne si la commande Rust échoue', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('commande inconnue'));
    const result = await loadLightIndexes();
    expect(result).toBe(fromRows);
    expect(buildLightIndexesFromSQLite).toHaveBeenCalledWith(
      [{ id: 'm' }], [{ id: 's' }], [{ id: 'l' }], [{ id: 'c' }]
    );
  });

  it('se rabat aussi sur le secours quand la base n\'est pas ouverte, sans appeler Rust', async () => {
    vi.mocked(getDatabaseFileName).mockReturnValue(null);
    const result = await loadLightIndexes();
    expect(invoke).not.toHaveBeenCalled();
    expect(result).toBe(fromRows);
  });

  it('se rabat sur le secours si la construction des index échoue', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({});
    vi.mocked(buildLightIndexesFromCatalog).mockImplementationOnce(() => { throw new Error('mal formé'); });
    expect(await loadLightIndexes()).toBe(fromRows);
  });

  it('propage l\'erreur si le secours échoue aussi', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('KO'));
    vi.mocked(getAllMovies).mockRejectedValueOnce(new Error('SQL KO'));
    await expect(loadLightIndexes()).rejects.toThrow('SQL KO');
  });
});

describe('catalogLight - buildIndexesRowByRow', () => {
  it('lit films, séries, direct et catégories puis construit les index', async () => {
    expect(await buildIndexesRowByRow()).toBe(fromRows);
    expect(getAllMovies).toHaveBeenCalledTimes(1);
    expect(getAllCategories).toHaveBeenCalledTimes(1);
  });
});
