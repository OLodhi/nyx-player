/**
 * Fausse table SQLite `watchlist` pour les tests de Ma liste.
 *
 * Reproduit ce qui compte pour la re-liaison : la clé primaire (stream_id, type), qui refuse deux
 * lignes au même numéro, et les requêtes simples des services (SELECT, INSERT OR REPLACE, DELETE et
 * UPDATE avec des conditions `colonne = ?`, `colonne != ?` ou `colonne > 0` reliées par AND).
 */

export interface FakeWatchlistRow {
    stream_id: number;
    tmdb_id: number;
    type: 'movie' | 'series';
    added_at: number;
    updated_at: number;
}

type Column = keyof FakeWatchlistRow;
type Condition = (row: FakeWatchlistRow, params: unknown[]) => boolean;

/** Conditions « a = ? AND b != ? AND c > 0 » ; chaque « ? » consomme le paramètre suivant. */
function parseWhere(where: string | undefined, firstParam: number): { test: Condition; used: number } {
    if (!where) return { test: () => true, used: 0 };
    const parts = where.split(/\s+AND\s+/i).map((p) => p.trim());
    let index = firstParam;
    const checks: Condition[] = parts.map((part) => {
        const match = /^(\w+)\s*(=|!=|>)\s*(\?|-?\d+)$/.exec(part);
        if (!match) throw new Error(`fakeWatchlistDb : condition non gérée « ${part} »`);
        const [, column, op, value] = match;
        const paramIndex = value === '?' ? index++ : -1;
        return (row, params) => {
            const expected = paramIndex >= 0 ? params[paramIndex] : Number(value);
            const actual = row[column as Column];
            if (op === '=') return actual === expected;
            if (op === '!=') return actual !== expected;
            return (actual as number) > (expected as number);
        };
    });
    return { test: (row, params) => checks.every((check) => check(row, params)), used: index - firstParam };
}

export function createFakeWatchlistDb(initial: Partial<FakeWatchlistRow>[]) {
    const rows: FakeWatchlistRow[] = initial.map((row, i) => ({
        stream_id: row.stream_id ?? 0,
        tmdb_id: row.tmdb_id ?? 0,
        type: row.type ?? 'movie',
        added_at: row.added_at ?? 1000 + i,
        updated_at: row.updated_at ?? 1000 + i,
    }));
    /** Écritures qui doivent échouer (pour simuler une erreur SQLite sur un seul titre) */
    const failures: ((sql: string, params: unknown[]) => boolean)[] = [];

    const assertUnique = () => {
        const seen = new Set<string>();
        for (const row of rows) {
            const key = `${row.stream_id}:${row.type}`;
            if (seen.has(key)) throw new Error('UNIQUE constraint failed: watchlist.stream_id, watchlist.type');
            seen.add(key);
        }
    };

    const db = {
        async select<T>(sql: string, params: unknown[] = []): Promise<T> {
            const match = /FROM watchlist(?:\s+WHERE\s+(.+))?$/is.exec(sql.trim());
            if (!match) throw new Error(`fakeWatchlistDb : SELECT non géré « ${sql} »`);
            const { test } = parseWhere(match[1], 0);
            return rows.filter((row) => test(row, params)).map((row) => ({ ...row })) as T;
        },

        async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
            if (failures.some((fail) => fail(sql, params))) throw new Error('database is locked');
            const text = sql.trim().replace(/\s+/g, ' ');

            const del = /^DELETE FROM watchlist(?: WHERE (.+))?$/i.exec(text);
            if (del) {
                const { test } = parseWhere(del[1], 0);
                const before = rows.length;
                for (let i = rows.length - 1; i >= 0; i--) if (test(rows[i], params)) rows.splice(i, 1);
                return { rowsAffected: before - rows.length };
            }

            const ins = /^INSERT OR REPLACE INTO watchlist \(stream_id, tmdb_id, type, added_at, updated_at\) VALUES \(\?, \?, \?, \?, \?\)$/i.exec(text);
            if (ins) {
                const [stream_id, tmdb_id, type, added_at, updated_at] = params as [number, number, 'movie' | 'series', number, number];
                const existing = rows.findIndex((row) => row.stream_id === stream_id && row.type === type);
                if (existing >= 0) rows.splice(existing, 1);
                rows.push({ stream_id, tmdb_id, type, added_at, updated_at });
                return { rowsAffected: 1 };
            }

            const upd = /^UPDATE watchlist SET stream_id = \? WHERE (.+)$/i.exec(text);
            if (upd) {
                const { test } = parseWhere(upd[1], 1);
                const snapshot = rows.map((row) => ({ ...row }));
                let affected = 0;
                for (const row of rows) {
                    if (test(row, params)) {
                        row.stream_id = params[0] as number;
                        affected++;
                    }
                }
                try {
                    assertUnique();
                } catch (err) {
                    rows.splice(0, rows.length, ...snapshot); // SQLite annule l'instruction entière
                    throw err;
                }
                return { rowsAffected: affected };
            }

            throw new Error(`fakeWatchlistDb : requête non gérée « ${sql} »`);
        },
    };

    return {
        db,
        rows,
        failWhen(predicate: (sql: string, params: unknown[]) => boolean) {
            failures.push(predicate);
        },
        /** Lignes triées, sous une forme courte et lisible dans les assertions */
        snapshot(): { stream_id: number; tmdb_id: number; type: string }[] {
            return rows
                .map(({ stream_id, tmdb_id, type }) => ({ stream_id, tmdb_id, type }))
                .sort((a, b) => a.tmdb_id - b.tmdb_id || a.stream_id - b.stream_id);
        },
    };
}
