/**
 * Accès à la base SQLite du compte par les commandes gardées de `src-tauri/src/secure_db.rs`.
 *
 * Remplace `@tauri-apps/plugin-sql` avec la même interface (`load`, `execute`, `select`, `close`),
 * pour que `dbCore.ts` et tous les services restent inchangés. Les commandes brutes du plugin ne
 * sont plus autorisées à la page (`src-tauri/capabilities/default.json`) : elles permettaient
 * d'ouvrir une base à n'importe quel chemin et d'exécuter `ATTACH` / `VACUUM INTO`, qui créent un
 * fichier où l'utilisateur peut écrire (le dossier Démarrage de Windows par exemple). Côté Rust,
 * seule `nyxplayer_<uuid>.db` s'ouvre, et `ATTACH`, `DETACH`, `VACUUM`, `PRAGMA` (sauf la lecture
 * de `data_version` par FTS5), les déclencheurs et les vues sont refusés.
 */
import { invoke } from '@tauri-apps/api/core';

export interface QueryResult {
  /** Nombre de lignes touchées par la requête */
  rowsAffected: number;
  /** Identifiant de la dernière ligne insérée */
  lastInsertId?: number;
}

export default class Database {
  /** Nom de la base, `sqlite:nyxplayer_<uuid>.db` */
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** Ouvre (et crée au besoin) la base du compte ; tout autre nom est refusé par Rust */
  static async load(path: string): Promise<Database> {
    const opened = await invoke<string>('nyx_db_load', { db: path });
    return new Database(opened);
  }

  async execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
    const [rowsAffected, lastInsertId] = await invoke<[number, number]>('nyx_db_execute', {
      db: this.path,
      query,
      values: bindValues ?? [],
    });
    return { lastInsertId, rowsAffected };
  }

  async select<T>(query: string, bindValues?: unknown[]): Promise<T> {
    return invoke<T>('nyx_db_select', { db: this.path, query, values: bindValues ?? [] });
  }

  /** Ferme la base nommée, ou toutes les bases sans argument (comme le plugin) */
  async close(db?: string): Promise<boolean> {
    return invoke<boolean>('nyx_db_close', { db });
  }
}
