/**
 * Ma liste lue une fois pour tout l'accueil TV : une seule lecture pour toutes les cartes, relue à chaque changement,
 * oubliée quand plus aucun écran ne l'utilise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { waitFor } from '@testing-library/react';

const db = vi.hoisted(() => ({ reads: 0, sets: [] as (Set<string> | Promise<Set<string>>)[], listeners: new Set<() => void>() }));
vi.mock('../../services/watchlistHydration', () => ({
    watchlistKeys: () => { db.reads++; return Promise.resolve(db.sets.shift() ?? new Set<string>()); },
    onWatchlistChange: (listener: () => void) => { db.listeners.add(listener); return () => db.listeners.delete(listener); },
}));

import { currentWatchlistKeys, onWatchlistKeys } from '../useWatchlistKeys';

beforeEach(() => { db.reads = 0; db.sets = []; db.listeners.clear(); });

describe('clés de Ma liste partagées', () => {
    it('une seule lecture pour plusieurs rangées, relue au changement, oubliée sans écran', async () => {
        db.sets = [new Set(['tmdb:movie:1']), new Set(['tmdb:movie:2'])];
        const [heardA, heardB] = [vi.fn(), vi.fn()];
        const stopA = onWatchlistKeys(heardA);
        const stopB = onWatchlistKeys(heardB);
        await waitFor(() => expect(currentWatchlistKeys()?.has('tmdb:movie:1')).toBe(true));
        expect(heardA).toHaveBeenCalledTimes(1);
        expect(heardB).toHaveBeenCalledTimes(1);
        expect(db.reads).toBe(1);

        db.listeners.forEach((listener) => listener());
        await waitFor(() => expect(currentWatchlistKeys()?.has('tmdb:movie:2')).toBe(true));
        expect(db.reads).toBe(2);

        stopA();
        stopB();
        expect(currentWatchlistKeys()).toBeNull();
        expect(db.listeners.size).toBe(0);
    });

    it('une réponse dépassée (changement arrivé entre-temps) est ignorée ; un nouvel écran relit la base', async () => {
        let first!: (set: Set<string>) => void;
        const slow = new Promise<Set<string>>((resolve) => { first = resolve; });
        db.sets = [slow, new Set(['tmdb:movie:3']), new Set(['tmdb:movie:4'])];
        const stopA = onWatchlistKeys(() => {});
        db.listeners.forEach((listener) => listener()); // seconde lecture, plus récente
        await waitFor(() => expect(currentWatchlistKeys()?.has('tmdb:movie:3')).toBe(true));
        first(new Set(['tmdb:movie:old']));
        await slow;
        expect(currentWatchlistKeys()?.has('tmdb:movie:old')).toBe(false);
        stopA();
        const stopB = onWatchlistKeys(() => {});
        await waitFor(() => expect(currentWatchlistKeys()?.has('tmdb:movie:4')).toBe(true));
        expect(db.reads).toBe(3);
        stopB();
    });
});
