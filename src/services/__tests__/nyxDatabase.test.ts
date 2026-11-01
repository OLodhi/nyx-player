/**
 * Base SQLite de la page : seulement par les commandes gardées de `secure_db.rs`, jamais par les
 * commandes brutes du plugin SQL, retirées des permissions (`src-tauri/capabilities/`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import Database from '../nyxDatabase';

const NAME = 'sqlite:nyxplayer_550e8400-e29b-41d4-a716-446655440000.db';

describe('nyxDatabase', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('ouvre la base par la commande gardée et garde le nom renvoyé', async () => {
    invoke.mockResolvedValue(NAME);
    const db = await Database.load(NAME);
    expect(invoke).toHaveBeenCalledWith('nyx_db_load', { db: NAME });
    expect(db.path).toBe(NAME);
  });

  it('execute renvoie les lignes touchées et le dernier identifiant, comme le plugin', async () => {
    const db = new Database(NAME);
    invoke.mockResolvedValue([3, 12]);
    await expect(db.execute('DELETE FROM t WHERE id = ?', [1])).resolves.toEqual({ rowsAffected: 3, lastInsertId: 12 });
    expect(invoke).toHaveBeenCalledWith('nyx_db_execute', { db: NAME, query: 'DELETE FROM t WHERE id = ?', values: [1] });

    await db.execute('DELETE FROM t');
    expect(invoke).toHaveBeenLastCalledWith('nyx_db_execute', { db: NAME, query: 'DELETE FROM t', values: [] });
  });

  it('select renvoie les lignes telles quelles', async () => {
    const db = new Database(NAME);
    invoke.mockResolvedValue([{ id: 1, name: 'a' }]);
    await expect(db.select('SELECT id, name FROM t')).resolves.toEqual([{ id: 1, name: 'a' }]);
    expect(invoke).toHaveBeenCalledWith('nyx_db_select', { db: NAME, query: 'SELECT id, name FROM t', values: [] });
  });

  it('close sans nom ferme toutes les bases, comme le plugin', async () => {
    invoke.mockResolvedValue(true);
    await new Database(NAME).close();
    expect(invoke).toHaveBeenCalledWith('nyx_db_close', { db: undefined });
  });

  it('une requête refusée par la garde remonte en erreur', async () => {
    invoke.mockRejectedValue('error returned from database: (code: 23) not authorized');
    await expect(new Database(NAME).execute("ATTACH 'x' AS y")).rejects.toMatch('not authorized');
  });

  it('aucune permission ne donne accès aux commandes brutes du plugin SQL', () => {
    const dir = resolve(__dirname, '../../../src-tauri/capabilities');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const capability = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { permissions: unknown[] };
      const sql = capability.permissions.filter((p) => JSON.stringify(p).includes('sql:'));
      expect(sql, file).toEqual([]);
    }
  });

  it('seul nyxDatabase.ts parle à la base : aucun autre fichier n\'importe le plugin SQL', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && /from ['"]@tauri-apps\/plugin-sql['"]/.test(readFileSync(path, 'utf8'))) {
          offenders.push(path);
        }
      }
    };
    walk(resolve(__dirname, '../..'));
    expect(offenders).toEqual([]);
  });
});
