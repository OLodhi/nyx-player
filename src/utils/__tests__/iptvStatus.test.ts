import { describe, it, expect } from 'vitest';
import type { LightIndexes } from '../../types/lightIndex';
import { computeIptvStatus } from '../iptvStatus';

/** Index avec le nombre voulu de chaînes, films et séries (le contenu n'est pas lu). */
function indexes(live: number, movies: number, series: number): LightIndexes {
    const map = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i + 1, {}]));
    return { live: map(live), movies: map(movies), series: map(series) } as unknown as LightIndexes;
}

describe('computeIptvStatus', () => {
    it('Un fournisseur « chaînes seulement » chargé en entier n’allume pas le voyant', () => {
        // Avant le correctif : 'warning' (voyant orange « catalogue incomplet ») faute de films et de séries
        expect(computeIptvStatus(indexes(120, 0, 0), false)).toBe('ok');
    });

    it('un fournisseur sans chaînes (films et séries seulement) est ok aussi', () => {
        expect(computeIptvStatus(indexes(0, 50, 20), false)).toBe('ok');
    });

    it('un chargement partiel reste signalé en orange', () => {
        expect(computeIptvStatus(indexes(120, 0, 0), true)).toBe('warning');
        expect(computeIptvStatus(indexes(120, 50, 20), true)).toBe('warning');
    });

    it('un catalogue vide est en erreur', () => {
        expect(computeIptvStatus(indexes(0, 0, 0), false)).toBe('error');
        expect(computeIptvStatus(indexes(0, 0, 0), true)).toBe('error');
    });

    it('pas encore de catalogue : ok', () => {
        expect(computeIptvStatus(null, true)).toBe('ok');
    });
});
