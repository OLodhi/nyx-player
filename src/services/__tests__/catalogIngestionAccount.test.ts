/**
 * Lecture du catalogue et compte Supabase : si le compte change pendant la
 * lecture, rien n'est nettoyé ni relié dans la base qui a pris la place.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentDb: string | null = 'nyxplayer_a.db';
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../dbCore', () => ({ getDatabaseFileName: () => currentDb }));
vi.mock('../preferencesService', () => ({ getDnsProvider: () => 'system' }));
const pushRelinkedProgress = vi.fn(async (..._args: unknown[]) => {});
vi.mock('../progressRelink', () => ({ pushRelinkedProgress: (...args: unknown[]) => pushRelinkedProgress(...args) }));

import { ingestCatalog, cancelCatalogIngestion, whenEpgLinksReady } from '../catalogIngestion';

const result = {
    movies_count: 1, series_count: 0, live_count: 0, categories_count: 0, duration_ms: 1, partial: false,
    failed_endpoints: [] as string[], logs: [], progress_relinks: [{ from: 5, to: 51 }],
};

beforeEach(() => {
    vi.clearAllMocks();
    currentDb = 'nyxplayer_a.db';
    invoke.mockImplementation(async (cmd: string) => (cmd === 'ingest_catalog' ? result : undefined));
});

describe('ingestCatalog et compte', () => {
    it('même compte : reprises re-liées envoyées au cloud et liens du guide sur la base lue', async () => {
        await ingestCatalog('http://h', 'u', 'p');
        expect(invoke).toHaveBeenCalledWith('ingest_catalog', expect.objectContaining({ dbName: 'nyxplayer_a.db' }));
        expect(pushRelinkedProgress).toHaveBeenCalledWith([{ from: 5, to: 51 }], expect.any(Function));
        expect(invoke).toHaveBeenCalledWith('remap_epg', { dbName: 'nyxplayer_a.db' });
    });

    it('autre compte pendant la lecture : rien n\'est fait dans la base du compte suivant', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'ingest_catalog') {
                currentDb = 'nyxplayer_b.db';
                return result;
            }
            return undefined;
        });

        await expect(ingestCatalog('http://h', 'u', 'p')).resolves.toEqual(result);

        expect(pushRelinkedProgress).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalledWith('remap_epg', expect.anything());
        warn.mockRestore();
    });
});

// Une lecture du catalogue n'efface plus aucune reprise.
// Le Rust re-lie seulement les reprises de films renumérotés, et seulement quand la liste des films
// est arrivée en entier (tests `ingestion.rs`) ; la page ne supprime plus rien et fait suivre le cloud.
describe('ingestCatalog et lecture en partie', () => {
    it('liste des films en échec : aucune reprise de film effacée', async () => {
        const partial = { ...result, movies_count: 0, partial: true, failed_endpoints: ['movies', 'movies_guarded'], progress_relinks: [] };
        invoke.mockImplementation(async (cmd: string) => (cmd === 'ingest_catalog' ? partial : undefined));

        await ingestCatalog('http://h', 'u', 'p');

        // Seules commandes : la lecture et la liaison au guide ; aucune écriture dans les reprises
        expect(invoke.mock.calls.map((call) => call[0])).toEqual(['ingest_catalog', 'remap_epg']);
        expect(pushRelinkedProgress).not.toHaveBeenCalled();
    });

    it('ancien Rust sans re-liaisons dans sa réponse : rien n\'est fait', async () => {
        const { progress_relinks: _omitted, ...older } = result;
        invoke.mockImplementation(async (cmd: string) => (cmd === 'ingest_catalog' ? older : undefined));

        await ingestCatalog('http://h', 'u', 'p');

        expect(pushRelinkedProgress).not.toHaveBeenCalled();
    });

    it('envoi au cloud impossible : la lecture du catalogue réussit quand même', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        pushRelinkedProgress.mockRejectedValueOnce(new Error('hors ligne'));

        await expect(ingestCatalog('http://h', 'u', 'p')).resolves.toEqual(result);
        warn.mockRestore();
    });
});

// La fin du recalcul des liens du guide est gardée, pour que la session relise
// le catalogue avec ses liens (sessionSteps.announceEpgLinksWhenReady)
describe('whenEpgLinksReady', () => {
    it('vrai une fois le recalcul des liens lancé par la lecture terminé', async () => {
        let finish: () => void = () => {};
        invoke.mockImplementation((cmd: string) => (cmd === 'ingest_catalog'
            ? Promise.resolve(result)
            : new Promise<void>((resolve) => { finish = resolve; })));

        await ingestCatalog('http://h', 'u', 'p');
        let linked: boolean | null = null;
        void whenEpgLinksReady().then((ok) => { linked = ok; });
        await Promise.resolve();
        expect(linked).toBeNull();

        finish();
        await expect(whenEpgLinksReady()).resolves.toBe(true);
    });

    it('recalcul en échec : faux, jamais d\'erreur', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invoke.mockImplementation(async (cmd: string) => {
            if (cmd === 'ingest_catalog') return result;
            throw new Error('base verrouillée');
        });

        await ingestCatalog('http://h', 'u', 'p');

        await expect(whenEpgLinksReady()).resolves.toBe(false);
        warn.mockRestore();
    });
});

describe('cancelCatalogIngestion', () => {
    it('demande l\'arrêt du chargement au Rust', async () => {
        await cancelCatalogIngestion();
        expect(invoke).toHaveBeenCalledWith('cancel_catalog_ingestion');
    });

    it('un échec de la demande ne remonte pas (déconnexion jamais bloquée)', async () => {
        invoke.mockRejectedValueOnce(new Error('absent'));
        await expect(cancelCatalogIngestion()).resolves.toBeUndefined();
    });
});
