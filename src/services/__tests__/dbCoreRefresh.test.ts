/**
 * refreshConnection (après l'ingestion Rust du catalogue) ne doit jamais laisser la base du
 * compte fermée sous son nom pendant qu'une synchro lancée à la connexion s'en sert. Avant la
 * correction, la synchro des reprises échouait par moments avec « attempted to acquire a connection
 * on a closed pool » sur un nouvel appareil, et « Reprendre la lecture » restait sans les reprises
 * du cloud jusqu'au lancement suivant.
 *
 * Le faux Rust ci-dessous reprend `src-tauri/src/secure_db.rs` : une base par nom, `close` ferme
 * le pool mais le laisse sous son nom (toute requête suivante échoue comme sqlx), `load` installe
 * un nouveau pool sous le nom. Les objets `Database` de la page ne gardent que le nom, comme
 * `nyxDatabase.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakePool { id: number; closed: boolean }
const pools = new Map<string, FakePool>();
let nextPoolId = 1;
/** Ouverture côté Rust retenue jusqu'à `releaseLoad` quand `holdLoads` est vrai */
let holdLoads = false;
let releaseLoad: () => void = () => {};
/** Résolue quand une ouverture retenue a commencé (releaseLoad est alors en place) */
let loadStarted: Promise<void> = Promise.resolve();
let markLoadStarted: () => void = () => {};

function holdNextLoads(): void {
    holdLoads = true;
    loadStarted = new Promise<void>((resolve) => { markLoadStarted = resolve; });
}

function rustQuery(name: string): FakePool {
    const pool = pools.get(name);
    if (!pool) throw new Error(`database ${name} not loaded`);
    if (pool.closed) throw new Error('attempted to acquire a connection on a closed pool');
    return pool;
}

class FakeDatabase {
    constructor(readonly path: string) {}
    static async load(name: string): Promise<FakeDatabase> {
        if (holdLoads) {
            const released = new Promise<void>((resolve) => { releaseLoad = resolve; });
            markLoadStarted();
            await released;
        }
        pools.set(name, { id: nextPoolId++, closed: false });
        return new FakeDatabase(name);
    }
    async execute(): Promise<{ rowsAffected: number }> {
        rustQuery(this.path);
        return { rowsAffected: 0 };
    }
    async select<T>(): Promise<T> {
        rustQuery(this.path);
        return [] as T;
    }
    async close(name?: string): Promise<boolean> {
        if (name === undefined) {
            for (const pool of pools.values()) pool.closed = true;
            return true;
        }
        const pool = pools.get(name);
        if (!pool) throw new Error(`database ${name} not loaded`);
        pool.closed = true;
        return true;
    }
}

vi.mock('../nyxDatabase', () => ({ default: { load: (name: string) => FakeDatabase.load(name) } }));

import { setDatabaseName, resetDatabaseName, getDatabase, refreshConnection, closeDatabaseConnection } from '../dbCore';

const NAME = 'sqlite:nyxplayer_a.db';

describe('refreshConnection et requêtes en cours', () => {
    beforeEach(async () => {
        holdLoads = false;
        releaseLoad(); // ouverture retenue par un test en échec
        await closeDatabaseConnection();
        resetDatabaseName();
        pools.clear();
    });

    it("une synchro qui tient la base pendant le recyclage n'échoue pas sur un pool fermé", async () => {
        setDatabaseName('a');
        const held = await getDatabase(); // la synchro des reprises a pris la base, puis attend le cloud

        holdNextLoads();
        const refreshing = refreshConnection(); // fin de l'ingestion Rust : recyclage
        await loadStarted;

        // Réponse du cloud arrivée pendant le recyclage : la synchro écrit ses reprises
        await expect(held.select('SELECT 1')).resolves.toEqual([]);
        await expect(held.execute('UPDATE playback_progress SET position_seconds = 1')).resolves.toBeDefined();

        holdLoads = false;
        releaseLoad();
        await refreshing;

        // Et après le recyclage aussi
        await expect(held.select('SELECT 1')).resolves.toEqual([]);
        await expect((await getDatabase()).select('SELECT 1')).resolves.toEqual([]);
    });

    it('le recyclage installe bien une nouvelle connexion (lecture de ce que le Rust vient d’écrire)', async () => {
        setDatabaseName('a');
        await getDatabase();
        const before = pools.get(NAME)?.id;
        await refreshConnection();
        const after = pools.get(NAME);
        expect(after?.id).not.toBe(before);
        expect(after?.closed).toBe(false);
    });

    it('compte fermé pendant le recyclage : la base du compte précédent ne reste pas ouverte', async () => {
        setDatabaseName('a');
        await getDatabase();

        holdNextLoads();
        const refreshing = refreshConnection();
        await loadStarted;
        const closing = closeDatabaseConnection(); // déconnexion ou remise à zéro pendant le recyclage
        resetDatabaseName();
        holdLoads = false;
        releaseLoad();

        await expect(refreshing).rejects.toThrow(/fermée/);
        await closing;
        expect(pools.get(NAME)?.closed).toBe(true);
    });
});
