/**
 * Tests for watchlistRelinking.ts
 *
 * Verifies re-linking of watchlist stream_id using tmdb_id + provider_hash.
 * Provider hash strategy: re-link is data-driven, not flag-driven.
 *
 * La table SQLite est simulée par fakeWatchlistDb (clé primaire (stream_id, type) comprise) : les
 * tests regardent ce qui reste réellement dans Ma liste, pas les requêtes envoyées.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFakeWatchlistDb } from './fakeWatchlistDb';
import type { FakeWatchlistRow } from './fakeWatchlistDb';

// ============================================================================
// MOCKS
// ============================================================================

let fake = createFakeWatchlistDb([]);

vi.mock('../dbCore', () => ({
    getDatabase: vi.fn(async () => fake.db),
}));

vi.mock('../../utils/devLog', () => ({
    devLog: vi.fn(),
}));

// ============================================================================
// IMPORT AFTER MOCKS
// ============================================================================

import { relinkWatchlistStreamIds } from '../watchlistRelinking';
import type { LightIndexes } from '../../types/lightIndex';
import { WATCHLIST_EVENT } from '../eventConstants';

// ============================================================================
// HELPERS
// ============================================================================

const HASH_A = 'aaaa1111';
const HASH_B = 'bbbb2222';

function makeLightIndexes(
    moviesByTmdb: Map<number, { id: number }>,
    seriesByTmdb: Map<number, { id: number }> = new Map()
): LightIndexes {
    return {
        movies: new Map(),
        series: new Map(),
        live: new Map(),
        categories: new Map(),
        moviesByTmdb: moviesByTmdb as LightIndexes['moviesByTmdb'],
        seriesByTmdb: seriesByTmdb as LightIndexes['seriesByTmdb'],
        iconPrefixes: [],
    };
}

function makeCloudItems(items: { tmdb_id: number; type: 'movie' | 'series'; provider_hash: string | null }[]) {
    return items;
}

function useRows(rows: Partial<FakeWatchlistRow>[]) {
    fake = createFakeWatchlistDb(rows);
}

/** Tous les titres au fournisseur actuel : seule la renumérotation déclenche la re-liaison */
function sameProvider(...tmdbIds: number[]) {
    return tmdbIds.map((tmdb_id) => ({ tmdb_id, type: 'movie' as const, provider_hash: HASH_A }));
}

// ============================================================================
// TESTS
// ============================================================================

describe('relinkWatchlistStreamIds', () => {
    beforeEach(() => {
        useRows([]);
    });

    it('re-links items when provider_hash differs from current', async () => {
        useRows([{ stream_id: 100, tmdb_id: 550, type: 'movie' }]);

        const indexes = makeLightIndexes(new Map([[550, { id: 999 }]]));
        const cloudItems = makeCloudItems([{ tmdb_id: 550, type: 'movie', provider_hash: HASH_A }]);

        const result = await relinkWatchlistStreamIds(indexes, HASH_B, cloudItems);

        expect(result.relinked).toBe(1);
        expect(result.orphaned).toBe(0);
        expect(result.relinkedItems).toEqual([
            { tmdb_id: 550, media_type: 'movie', stream_id: 999, provider_hash: HASH_B },
        ]);
        expect(fake.snapshot()).toEqual([{ stream_id: 999, tmdb_id: 550, type: 'movie' }]);
    });

    it('counts orphaned items when tmdb_id not found in new provider (hash mismatch)', async () => {
        useRows([{ stream_id: 200, tmdb_id: 12345, type: 'series' }]);

        const indexes = makeLightIndexes(new Map(), new Map());
        const cloudItems = makeCloudItems([{ tmdb_id: 12345, type: 'series', provider_hash: HASH_A }]);

        const result = await relinkWatchlistStreamIds(indexes, HASH_B, cloudItems);

        expect(result.relinked).toBe(0);
        expect(result.orphaned).toBe(1);
        expect(result.relinkedItems).toHaveLength(0);
        expect(fake.snapshot()).toEqual([{ stream_id: 200, tmdb_id: 12345, type: 'series' }]);
    });

    it('does not update if hash matches and stream_id is correct', async () => {
        useRows([{ stream_id: 42, tmdb_id: 777, type: 'movie' }]);
        const execute = vi.spyOn(fake.db, 'execute');

        const indexes = makeLightIndexes(new Map([[777, { id: 42 }]]));
        const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(777));

        expect(result.relinked).toBe(0);
        expect(result.orphaned).toBe(0);
        expect(result.relinkedItems).toHaveLength(0);
        expect(execute).not.toHaveBeenCalled();
    });

    it('re-links when hash matches but stream_id is different (stream moved)', async () => {
        useRows([{ stream_id: 42, tmdb_id: 777, type: 'movie' }]);

        const indexes = makeLightIndexes(new Map([[777, { id: 99 }]])); // same provider, stream moved from 42 to 99
        const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(777));

        expect(result.relinked).toBe(1);
        expect(result.relinkedItems).toEqual([
            { tmdb_id: 777, media_type: 'movie', stream_id: 99, provider_hash: HASH_A },
        ]);
        expect(fake.snapshot()).toEqual([{ stream_id: 99, tmdb_id: 777, type: 'movie' }]);
    });

    it('returns zeros when watchlist is empty', async () => {
        const execute = vi.spyOn(fake.db, 'execute');
        const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map()), HASH_A);

        expect(result).toEqual({ relinked: 0, orphaned: 0, relinkedItems: [] });
        expect(execute).not.toHaveBeenCalled();
    });

    it('handles mixed relinked and orphaned items', async () => {
        useRows([
            { stream_id: 10, tmdb_id: 100, type: 'movie' },    // → will be relinked (hash mismatch)
            { stream_id: 20, tmdb_id: 200, type: 'series' },   // → orphaned (not in new catalog)
            { stream_id: 30, tmdb_id: 300, type: 'movie' },    // → same hash, same stream → skip
            { stream_id: 40, tmdb_id: 400, type: 'series' },   // → relinked (hash mismatch)
        ]);

        const indexes = makeLightIndexes(
            new Map([
                [100, { id: 11 }],  // different stream → relink
                [300, { id: 30 }],  // same stream → skip
            ]),
            new Map([
                [400, { id: 44 }],  // different stream → relink
                // 200 missing → orphaned
            ])
        );

        const cloudItems = makeCloudItems([
            { tmdb_id: 100, type: 'movie', provider_hash: HASH_A },
            { tmdb_id: 200, type: 'series', provider_hash: HASH_A },
            { tmdb_id: 300, type: 'movie', provider_hash: HASH_B }, // matches current
            { tmdb_id: 400, type: 'series', provider_hash: HASH_A },
        ]);

        const result = await relinkWatchlistStreamIds(indexes, HASH_B, cloudItems);

        expect(result.relinked).toBe(2);
        expect(result.orphaned).toBe(1);
        expect(result.relinkedItems).toHaveLength(2);
        expect(fake.snapshot()).toEqual([
            { stream_id: 11, tmdb_id: 100, type: 'movie' },
            { stream_id: 20, tmdb_id: 200, type: 'series' },
            { stream_id: 30, tmdb_id: 300, type: 'movie' },
            { stream_id: 44, tmdb_id: 400, type: 'series' },
        ]);
    });

    it('works without cloudItems (treats all as hash mismatch)', async () => {
        useRows([{ stream_id: 100, tmdb_id: 550, type: 'movie' }]);

        const indexes = makeLightIndexes(new Map([[550, { id: 999 }]]));

        // No cloudItems passed → all items have null hash → hash mismatch with currentHash
        const result = await relinkWatchlistStreamIds(indexes, HASH_A);

        expect(result.relinked).toBe(1);
        expect(result.relinkedItems[0].stream_id).toBe(999);
    });

    it('returns relinkedItems with correct provider_hash for cloud push', async () => {
        useRows([
            { stream_id: 10, tmdb_id: 100, type: 'movie' },
            { stream_id: 20, tmdb_id: 200, type: 'series' },
        ]);

        const indexes = makeLightIndexes(
            new Map([[100, { id: 50 }]]),
            new Map([[200, { id: 60 }]])
        );
        const cloudItems = makeCloudItems([
            { tmdb_id: 100, type: 'movie', provider_hash: HASH_A },
            { tmdb_id: 200, type: 'series', provider_hash: HASH_A },
        ]);

        const result = await relinkWatchlistStreamIds(indexes, HASH_B, cloudItems);

        expect(result.relinkedItems).toEqual([
            { tmdb_id: 100, media_type: 'movie', stream_id: 50, provider_hash: HASH_B },
            { tmdb_id: 200, media_type: 'series', stream_id: 60, provider_hash: HASH_B },
        ]);
    });

    it('re-links when only the provider changed, without rewriting the row', async () => {
        useRows([{ stream_id: 42, tmdb_id: 777, type: 'movie' }]);
        const execute = vi.spyOn(fake.db, 'execute');

        const indexes = makeLightIndexes(new Map([[777, { id: 42 }]]));
        const result = await relinkWatchlistStreamIds(indexes, HASH_B, sameProvider(777));

        expect(result.relinkedItems).toEqual([
            { tmdb_id: 777, media_type: 'movie', stream_id: 42, provider_hash: HASH_B },
        ]);
        expect(execute).not.toHaveBeenCalled();
    });

    it('announces the change to the screens only when Ma liste changed', async () => {
        const listener = vi.fn();
        window.addEventListener(WATCHLIST_EVENT, listener);
        try {
            useRows([{ stream_id: 42, tmdb_id: 777, type: 'movie' }]);
            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[777, { id: 42 }]])), HASH_A, sameProvider(777));
            expect(listener).not.toHaveBeenCalled();

            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[777, { id: 43 }]])), HASH_A, sameProvider(777));
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener(WATCHLIST_EVENT, listener);
        }
    });

    // ------------------------------------------------------------------------
    // Renumérotations croisées et doublons
    // ------------------------------------------------------------------------

    describe('renumérotations croisées et doublons', () => {
        it('keeps both titles when one takes the number the other leaves (A 100 → 200, B 200 → 300)', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' }, // A, lu en premier
                { stream_id: 200, tmdb_id: 2, type: 'movie' }, // B
            ]);
            const indexes = makeLightIndexes(new Map([[1, { id: 200 }], [2, { id: 300 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: 200, tmdb_id: 1, type: 'movie' },
                { stream_id: 300, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.relinked).toBe(2);
            expect(result.relinkedItems.map((i) => [i.tmdb_id, i.stream_id])).toEqual([[1, 200], [2, 300]]);
        });

        it('keeps both titles when they exchange their numbers (A 100 → 200, B 200 → 100)', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 200, tmdb_id: 2, type: 'movie' },
            ]);
            const indexes = makeLightIndexes(new Map([[1, { id: 200 }], [2, { id: 100 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: 200, tmdb_id: 1, type: 'movie' },
                { stream_id: 100, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.relinked).toBe(2);
        });

        it('keeps the date a title was added when it is renumbered', async () => {
            useRows([{ stream_id: 100, tmdb_id: 1, type: 'movie', added_at: 1234 }]);

            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 200 }]])), HASH_A, sameProvider(1));

            expect(fake.rows[0]).toMatchObject({ stream_id: 200, added_at: 1234 });
        });

        it('keeps one row per title when the local list holds the same title twice', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie', updated_at: 2000 },
                { stream_id: 150, tmdb_id: 1, type: 'movie', updated_at: 3000 },
                { stream_id: 500, tmdb_id: 5, type: 'movie' },
            ]);
            const indexes = makeLightIndexes(new Map([[1, { id: 200 }], [5, { id: 600 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(1, 5));

            expect(fake.snapshot()).toEqual([
                { stream_id: 200, tmdb_id: 1, type: 'movie' },
                { stream_id: 600, tmdb_id: 5, type: 'movie' },
            ]);
            expect(result.relinkedItems.map((i) => [i.tmdb_id, i.stream_id])).toEqual([[1, 200], [5, 600]]);
        });

        it('keeps, among duplicates, the row already at the right number', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie', updated_at: 9000 },
                { stream_id: 200, tmdb_id: 1, type: 'movie', updated_at: 1000 },
            ]);
            const execute = vi.spyOn(fake.db, 'execute');

            const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 200 }]])), HASH_A, sameProvider(1));

            expect(fake.snapshot()).toEqual([{ stream_id: 200, tmdb_id: 1, type: 'movie' }]);
            expect(execute).toHaveBeenCalledTimes(1); // le doublon seulement
            expect(result.relinkedItems).toEqual([]);
        });

        it('keeps the same title twice when it is a movie and a series', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 100, tmdb_id: 1, type: 'series' },
            ]);
            const indexes = makeLightIndexes(new Map([[1, { id: 100 }]]), new Map([[1, { id: 100 }]]));

            await relinkWatchlistStreamIds(indexes, HASH_A, [
                { tmdb_id: 1, type: 'movie', provider_hash: HASH_A },
                { tmdb_id: 1, type: 'series', provider_hash: HASH_A },
            ]);

            expect(fake.rows).toHaveLength(2);
        });

        it('carries on with the other titles when writing one of them fails', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 200, tmdb_id: 2, type: 'movie' },
            ]);
            fake.failWhen((sql, params) => sql.startsWith('UPDATE') && params[0] === 101);
            const indexes = makeLightIndexes(new Map([[1, { id: 101 }], [2, { id: 201 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: 100, tmdb_id: 1, type: 'movie' }, // remis à son ancien numéro
                { stream_id: 201, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.relinkedItems.map((i) => i.tmdb_id)).toEqual([2]);
        });

        it('never reports a number of zero or below for the cloud', async () => {
            useRows([{ stream_id: 100, tmdb_id: 1, type: 'movie' }]);

            const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 0 }]])), HASH_B, sameProvider(1));

            expect(result.relinkedItems).toEqual([]);
            expect(fake.snapshot()).toEqual([{ stream_id: 100, tmdb_id: 1, type: 'movie' }]);
        });

        it('repairs a row left on a provisional number by an interrupted re-link', async () => {
            useRows([{ stream_id: -1, tmdb_id: 1, type: 'movie' }]);

            const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 200 }]])), HASH_A, sameProvider(1));

            expect(fake.snapshot()).toEqual([{ stream_id: 200, tmdb_id: 1, type: 'movie' }]);
            expect(result.relinkedItems.map((i) => i.stream_id)).toEqual([200]);
        });

        it('still replaces a stale row that sits on the number of a re-linked title', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 200, tmdb_id: 0, type: 'movie' }, // ligne sans TMDB, numéro repris par A
            ]);

            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 200 }]])), HASH_A, sameProvider(1));

            expect(fake.snapshot()).toEqual([{ stream_id: 200, tmdb_id: 1, type: 'movie' }]);
        });

        it('never removes a title already at its right number when another title claims it', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 200, tmdb_id: 2, type: 'movie' },
            ]);
            // Catalogue incohérent : deux titres TMDB pointent vers le même numéro
            const indexes = makeLightIndexes(new Map([[1, { id: 200 }], [2, { id: 200 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 200, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.relinkedItems).toEqual([]);
        });

        // Un titre « Introuvable » (absent du catalogue actuel,
        // gardé et grisé) n'est jamais effacé quand un autre titre de Ma liste
        // prend son numéro : il passe sur un numéro provisoire négatif, et reste dans le dernier accord
        // (la synchro ne le retire ni du cloud ni des autres appareils).
        it('never removes an « Introuvable » title when another title takes its number', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' }, // X : absent du catalogue actuel
                { stream_id: 555, tmdb_id: 2, type: 'movie' }, // Y : le fournisseur lui donne le 100
            ]);

            const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map([[2, { id: 100 }]])), HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: -1, tmdb_id: 1, type: 'movie' },
                { stream_id: 100, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.orphaned).toBe(1);
            expect(result.relinkedItems).toEqual([{ tmdb_id: 2, media_type: 'movie', stream_id: 100, provider_hash: HASH_A }]);
        });

        it('an « Introuvable » title set aside comes back to a real number once the catalog has it again', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 555, tmdb_id: 2, type: 'movie' },
            ]);
            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[2, { id: 100 }]])), HASH_A, sameProvider(1, 2));

            await relinkWatchlistStreamIds(makeLightIndexes(new Map([[1, { id: 300 }], [2, { id: 100 }]])), HASH_A, sameProvider(1, 2));

            expect(fake.snapshot()).toEqual([
                { stream_id: 300, tmdb_id: 1, type: 'movie' },
                { stream_id: 100, tmdb_id: 2, type: 'movie' },
            ]);
        });

        it('if setting the « Introuvable » title aside fails, both titles keep their numbers', async () => {
            useRows([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 555, tmdb_id: 2, type: 'movie' },
            ]);
            fake.failWhen((sql, params) => sql.includes('tmdb_id = ?') && params[3] === 1);
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await relinkWatchlistStreamIds(makeLightIndexes(new Map([[2, { id: 100 }]])), HASH_A, sameProvider(1, 2));
            warn.mockRestore();

            expect(fake.snapshot()).toEqual([
                { stream_id: 100, tmdb_id: 1, type: 'movie' },
                { stream_id: 555, tmdb_id: 2, type: 'movie' },
            ]);
            expect(result.relinkedItems).toEqual([]);
        });
    });

    describe('session fermée avant la re-liaison', () => {
        it('ne réécrit rien quand la session a déjà changé', async () => {
            fake = createFakeWatchlistDb([{ stream_id: 100, tmdb_id: 42, type: 'movie', added_at: 1, updated_at: 1 }]);
            const indexes = makeLightIndexes(new Map([[42, { id: 200 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, [], { isStillCurrent: () => false });

            expect(result.relinked).toBe(0);
            expect(fake.snapshot()).toEqual([{ stream_id: 100, tmdb_id: 42, type: 'movie' }]);
        });

        it('va au bout quand la session est toujours là', async () => {
            fake = createFakeWatchlistDb([{ stream_id: 100, tmdb_id: 42, type: 'movie', added_at: 1, updated_at: 1 }]);
            const indexes = makeLightIndexes(new Map([[42, { id: 200 }]]));

            const result = await relinkWatchlistStreamIds(indexes, HASH_A, [], { isStillCurrent: () => true });

            expect(result.relinked).toBe(1);
            expect(fake.snapshot()).toEqual([{ stream_id: 200, tmdb_id: 42, type: 'movie' }]);
        });
    });
});
