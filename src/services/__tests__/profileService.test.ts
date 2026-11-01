/**
 * Tests pour profileService — Phase 1.5
 *
 * Teste le CRUD profils via mocks Supabase :
 * - getProfiles retourne les profils
 * - ensureDefaultProfile auto-crée si aucun, sans doublon en cas de course
 * - updateProfileName appelle update
 * - setActiveProfile désactive tous puis active le bon
 * - Gestion des erreurs Supabase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// MOCKS
// ============================================================================

const mockFrom = vi.fn();

vi.mock('../supabaseClient', () => ({
    supabase: {
        from: (...args: unknown[]) => mockFrom(...args),
    },
}));

/** Table meta de la base locale du compte (liste des profils gardée pour le hors-ligne) */
const meta = new Map<string, string>();
let databaseIsOurs = true;
vi.mock('../dbCore', () => ({
    getMeta: vi.fn(async (key: string) => meta.get(key) ?? null),
    setMeta: vi.fn(async (key: string, value: string) => { meta.set(key, value); }),
    isDatabaseOf: vi.fn(() => databaseIsOurs),
}));

// ============================================================================
// IMPORT APRÈS MOCKS
// ============================================================================

import {
    loadProfiles,
    getProfiles,
    ensureDefaultProfile,
    updateProfileName,
    setActiveProfile,
    needsActiveProfileUpdate,
} from '../profileService';

// ============================================================================
// HELPERS
// ============================================================================

const TEST_USER_ID = 'test-user-uuid';
const TEST_PROFILE = {
    id: 'profile-uuid-1',
    user_id: TEST_USER_ID,
    display_name: 'Profile 1',
    avatar_color: '#F4A8A8',
    is_active: true,
    created_at: '2026-03-05T00:00:00Z',
    updated_at: '2026-03-05T00:00:00Z',
};

/**
 * Helper pour construire un mock de chaîne Supabase select().eq().order()
 */
function mockSelectChain(data: unknown, error: unknown = null) {
    return {
        select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({ data, error }),
            }),
        }),
    };
}

/**
 * Helper pour construire un mock de chaîne Supabase insert().select().single()
 */
function mockInsertChain(data: unknown, error: unknown = null) {
    return {
        insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data, error }),
            }),
        }),
    };
}

/**
 * Helper pour construire un mock de chaîne Supabase update().eq()
 */
function mockUpdateChain(error: unknown = null, data: unknown = [{ id: 'profile-uuid-1' }]) {
    // Filtres enchaînables (`.eq().eq().select()`), et la chaîne attendue rend la réponse
    const chain = {
        eq: vi.fn(() => chain),
        select: vi.fn(() => chain),
        then: (resolve: (value: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data, error }).then(resolve),
    };
    return { update: vi.fn().mockReturnValue(chain), chain };
}

/**
 * Table `user_profiles` simulée en mémoire, pour rejouer les courses de création.
 * Chaque réponse arrive après un tour de boucle, comme une vraie requête réseau : deux appels
 * lancés ensemble lisent donc tous les deux la table avant que l'un d'eux n'y écrive.
 */
function fakeProfilesTable(options: { deleteError?: { message: string }; deleteDenied?: boolean; failSelectAfterInsert?: boolean } = {}) {
    const state = { rows: [] as typeof TEST_PROFILE[], inserts: 0, selects: 0, deletes: 0 };
    let seq = 0;
    const later = <T,>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 0));
    mockFrom.mockImplementation(() => ({
        select: () => ({
            eq: (_col: string, userId: string) => ({
                order: () => {
                    state.selects++;
                    if (options.failSelectAfterInsert && state.inserts > 0) {
                        return later({ data: null, error: { message: 'Network error' } });
                    }
                    return later({ data: state.rows.filter((r) => r.user_id === userId), error: null });
                },
            }),
        }),
        insert: (row: Partial<typeof TEST_PROFILE>) => ({
            select: () => ({
                single: () => {
                    state.inserts++;
                    seq++;
                    const created = {
                        ...TEST_PROFILE,
                        ...row,
                        id: `profile-${seq}`,
                        created_at: `2026-09-29T21:00:0${seq}Z`,
                    } as typeof TEST_PROFILE;
                    state.rows.push(created);
                    return later({ data: created, error: null });
                },
            }),
        }),
        delete: () => ({
            eq: (_idCol: string, id: string) => ({
                eq: (_userCol: string, userId: string) => ({
                    select: () => {
                        if (options.deleteError) return later({ data: null, error: options.deleteError });
                        if (options.deleteDenied) return later({ data: [], error: null });
                        const removed = state.rows.filter((r) => r.id === id && r.user_id === userId);
                        state.deletes += removed.length;
                        state.rows = state.rows.filter((r) => !removed.includes(r));
                        return later({ data: removed.map((r) => ({ id: r.id })), error: null });
                    },
                }),
            }),
        }),
    }));
    return state;
}

// ============================================================================
// TESTS
// ============================================================================

describe('profileService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ============================
    // getProfiles
    // ============================
    describe('getProfiles', () => {
        it('retourne les profils du user', async () => {
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));

            const result = await getProfiles(TEST_USER_ID);
            expect(result).toEqual([TEST_PROFILE]);
            expect(mockFrom).toHaveBeenCalledWith('user_profiles');
        });

        it('retourne un tableau vide si aucun profil', async () => {
            mockFrom.mockReturnValue(mockSelectChain([]));

            const result = await getProfiles(TEST_USER_ID);
            expect(result).toEqual([]);
        });

        it('throw si erreur Supabase', async () => {
            mockFrom.mockReturnValue(
                mockSelectChain(null, { message: 'Network error' })
            );

            await expect(getProfiles(TEST_USER_ID)).rejects.toThrow(
                '[ProfileService] getProfiles failed: Network error'
            );
        });
    });

    // ============================
    // ensureDefaultProfile
    // ============================
    describe('ensureDefaultProfile', () => {
        it('retourne les profils existants sans créer', async () => {
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));

            const result = await ensureDefaultProfile(TEST_USER_ID);
            expect(result).toEqual([TEST_PROFILE]);
            // from() appelé une seule fois (getProfiles), pas d'insert
            expect(mockFrom).toHaveBeenCalledTimes(1);
        });

        it('crée Profile 1 si aucun profil', async () => {
            const table = fakeProfilesTable();

            const result = await ensureDefaultProfile(TEST_USER_ID);
            expect(result).toHaveLength(1);
            expect(result[0]).toMatchObject({ user_id: TEST_USER_ID, display_name: 'Profile 1', is_active: true });
            expect(table.rows).toEqual(result);
            expect(table.inserts).toBe(1);
        });

        it('throw si erreur lors de la création', async () => {
            let callCount = 0;
            mockFrom.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return mockSelectChain([]);
                }
                return mockInsertChain(null, { message: 'Insert failed' });
            });

            await expect(ensureDefaultProfile(TEST_USER_ID)).rejects.toThrow(
                '[ProfileService] ensureDefaultProfile failed: Insert failed'
            );
        });

        // Course du double démarrage : avant, chaque appel lisait « aucun profil » puis créait le sien
        it('deux appels simultanés sur le même appareil ne créent qu\'un seul profil', async () => {
            const table = fakeProfilesTable();

            const [a, b] = await Promise.all([
                ensureDefaultProfile(TEST_USER_ID),
                ensureDefaultProfile(TEST_USER_ID),
            ]);

            expect(table.inserts).toBe(1);
            expect(table.rows).toHaveLength(1);
            expect(a).toEqual(table.rows);
            expect(b).toEqual(table.rows);
        });

        it('rappelle Supabase une fois la création précédente terminée', async () => {
            const table = fakeProfilesTable();

            await ensureDefaultProfile(TEST_USER_ID);
            const again = await ensureDefaultProfile(TEST_USER_ID);

            expect(table.inserts).toBe(1);
            expect(table.selects).toBe(3); // lecture, vérification après création, puis nouvelle lecture
            expect(again).toEqual(table.rows);
        });

        it('les comptes différents ne partagent pas la même création', async () => {
            const table = fakeProfilesTable();

            await Promise.all([ensureDefaultProfile('user-a'), ensureDefaultProfile('user-b')]);

            expect(table.rows.map((p) => p.user_id).sort()).toEqual(['user-a', 'user-b']);
        });

        // Course entre deux appareils : les deux lisent « aucun profil » et créent chacun le leur
        it('deux appareils en même temps : un seul profil reste, le même des deux côtés', async () => {
            const table = fakeProfilesTable();
            const deviceA = await import('../profileService');
            vi.resetModules();
            const deviceB = await import('../profileService');

            const [a, b] = await Promise.all([
                deviceA.ensureDefaultProfile(TEST_USER_ID),
                deviceB.ensureDefaultProfile(TEST_USER_ID),
            ]);

            expect(table.inserts).toBe(2);
            expect(table.deletes).toBe(1);
            expect(table.rows).toHaveLength(1);
            expect(a).toEqual(table.rows);
            expect(b).toEqual(table.rows);
        });

        it('deux appareils : si le retrait du doublon échoue, les deux prennent le plus ancien (le doublon reste en base jusqu\'au nettoyage)', async () => {
            const table = fakeProfilesTable({ deleteError: { message: 'RLS denied' } });
            const deviceA = await import('../profileService');
            vi.resetModules();
            const deviceB = await import('../profileService');
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const [a, b] = await Promise.all([
                deviceA.ensureDefaultProfile(TEST_USER_ID),
                deviceB.ensureDefaultProfile(TEST_USER_ID),
            ]);

            expect(table.rows).toHaveLength(2);
            expect(a).toEqual(b);
            expect(a).toEqual([table.rows[0]]);
            expect(warn).toHaveBeenCalledWith(
                '[ProfileService] duplicate default profile not removed:', 'RLS denied');
            warn.mockRestore();
        });

        it('deux appareils : suppression refusée sans erreur par la règle d\'accès, signalée dans le journal (le doublon reste en base)', async () => {
            const table = fakeProfilesTable({ deleteDenied: true });
            const deviceA = await import('../profileService');
            vi.resetModules();
            const deviceB = await import('../profileService');
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const [a, b] = await Promise.all([
                deviceA.ensureDefaultProfile(TEST_USER_ID),
                deviceB.ensureDefaultProfile(TEST_USER_ID),
            ]);

            expect(table.rows).toHaveLength(2);
            expect(a).toEqual([table.rows[0]]);
            expect(b).toEqual([table.rows[0]]);
            expect(warn).toHaveBeenCalledWith(
                '[ProfileService] duplicate default profile not removed: nothing deleted');
            warn.mockRestore();
        });

        it('création refusée par un index unique (autre appareil plus rapide) : prend le profil existant', async () => {
            let callCount = 0;
            mockFrom.mockImplementation(() => {
                callCount++;
                if (callCount === 1) return mockSelectChain([]);
                if (callCount === 2) return mockInsertChain(null, { message: 'duplicate key', code: '23505' });
                return mockSelectChain([TEST_PROFILE]);
            });

            const result = await ensureDefaultProfile(TEST_USER_ID);
            expect(result).toEqual([TEST_PROFILE]);
        });

        it('après un échec, un nouvel appel repart de zéro au lieu de reprendre l\'échec', async () => {
            let callCount = 0;
            mockFrom.mockImplementation(() => {
                callCount++;
                if (callCount === 1) return mockSelectChain(null, { message: 'Network error' });
                return mockSelectChain([TEST_PROFILE]);
            });

            await expect(ensureDefaultProfile(TEST_USER_ID)).rejects.toThrow('Network error');
            await expect(ensureDefaultProfile(TEST_USER_ID)).resolves.toEqual([TEST_PROFILE]);
        });

        it('garde le profil créé si la vérification après création échoue (réseau coupé)', async () => {
            const table = fakeProfilesTable({ failSelectAfterInsert: true });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const result = await ensureDefaultProfile(TEST_USER_ID);

            expect(result).toEqual(table.rows);
            expect(table.deletes).toBe(0);
            warn.mockRestore();
        });
    });

    // ============================
    // updateProfileName
    // ============================
    describe('updateProfileName', () => {
        it('appelle update avec le bon nom', async () => {
            mockFrom.mockReturnValue(mockUpdateChain());

            await updateProfileName(TEST_USER_ID, 'profile-uuid-1', 'Mon Profil');
            expect(mockFrom).toHaveBeenCalledWith('user_profiles');
        });

        // Le profil d'un autre compte n'est jamais visé, même si la règle
        // d'accès de la base venait à manquer (défense en profondeur).
        it('filtre par profil ET par compte', async () => {
            const table = mockUpdateChain();
            mockFrom.mockReturnValue(table);
            await updateProfileName(TEST_USER_ID, 'profile-uuid-1', 'Mon Profil');
            expect(table.chain.eq).toHaveBeenCalledWith('id', 'profile-uuid-1');
            expect(table.chain.eq).toHaveBeenCalledWith('user_id', TEST_USER_ID);
        });

        it('aucune ligne touchée (profil d\'un autre compte) : erreur, pas de faux succès', async () => {
            mockFrom.mockReturnValue(mockUpdateChain(null, []));
            await expect(updateProfileName(TEST_USER_ID, 'profile-uuid-1', 'X')).rejects.toThrow('profile not found');
        });

        it('throw si erreur Supabase', async () => {
            mockFrom.mockReturnValue(
                mockUpdateChain({ message: 'RLS denied' })
            );

            await expect(
                updateProfileName(TEST_USER_ID, 'profile-uuid-1', 'Fail')
            ).rejects.toThrow('[ProfileService] updateProfileName failed: RLS denied');
        });
    });

    // ============================
    // setActiveProfile
    // ============================
    describe('setActiveProfile', () => {
        it('désactive tous puis active le bon profil', async () => {
            mockFrom.mockReturnValue(mockUpdateChain());

            await setActiveProfile(TEST_USER_ID, 'profile-uuid-1');
            // 2 appels: deactivate all + activate one
            expect(mockFrom).toHaveBeenCalledTimes(2);
        });

        it('active le profil de ce compte seulement', async () => {
            const deactivate = mockUpdateChain();
            const activate = mockUpdateChain();
            mockFrom.mockReturnValueOnce(deactivate).mockReturnValueOnce(activate);
            await setActiveProfile(TEST_USER_ID, 'profile-uuid-1');
            expect(deactivate.chain.eq).toHaveBeenCalledWith('user_id', TEST_USER_ID);
            expect(activate.chain.eq).toHaveBeenCalledWith('id', 'profile-uuid-1');
            expect(activate.chain.eq).toHaveBeenCalledWith('user_id', TEST_USER_ID);
        });

        it('throw si erreur à la désactivation', async () => {
            mockFrom.mockReturnValue(
                mockUpdateChain({ message: 'Deactivate failed' })
            );

            await expect(
                setActiveProfile(TEST_USER_ID, 'profile-uuid-1')
            ).rejects.toThrow('setActiveProfile deactivate failed');
        });
    });

    // ============================
    // loadProfiles — démarrage sans réseau
    // ============================
    describe('loadProfiles', () => {
        beforeEach(() => {
            meta.clear();
            databaseIsOurs = true;
        });

        it('retourne les profils de Supabase et les garde sur l\'appareil', async () => {
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));

            await expect(loadProfiles(TEST_USER_ID)).resolves.toEqual({ profiles: [TEST_PROFILE], offline: false });
            expect(JSON.parse(meta.get('cached_profiles')!)).toEqual([TEST_PROFILE]);
        });

        it('sans réseau, ouvre avec les profils gardés au lieu de rester bloqué sur une erreur', async () => {
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));
            await loadProfiles(TEST_USER_ID);
            mockFrom.mockReturnValue(mockSelectChain(null, { message: 'TypeError: Failed to fetch' }));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

            await expect(loadProfiles(TEST_USER_ID)).resolves.toEqual({ profiles: [TEST_PROFILE], offline: true });
            warn.mockRestore();
        });

        it('sans réseau et sans profils gardés (premier lancement), renvoie l\'erreur', async () => {
            mockFrom.mockReturnValue(mockSelectChain(null, { message: 'TypeError: Failed to fetch' }));

            await expect(loadProfiles(TEST_USER_ID)).rejects.toThrow('Failed to fetch');
        });

        it('n\'utilise jamais les profils gardés d\'un autre compte', async () => {
            meta.set('cached_profiles', JSON.stringify([{ ...TEST_PROFILE, user_id: 'autre-compte' }]));
            mockFrom.mockReturnValue(mockSelectChain(null, { message: 'TypeError: Failed to fetch' }));

            await expect(loadProfiles(TEST_USER_ID)).rejects.toThrow('Failed to fetch');
        });

        it('n\'attend pas l\'écriture de la copie locale : une base occupée ne retarde pas l\'écran des profils', async () => {
            const { setMeta } = await import('../dbCore');
            let release!: () => void;
            vi.mocked(setMeta).mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));

            await expect(loadProfiles(TEST_USER_ID)).resolves.toEqual({ profiles: [TEST_PROFILE], offline: false });
            expect(setMeta).toHaveBeenCalledWith('cached_profiles', JSON.stringify([TEST_PROFILE]));
            release();
        });

        it('ne lit ni n\'écrit la base d\'un autre compte', async () => {
            databaseIsOurs = false;
            mockFrom.mockReturnValue(mockSelectChain([TEST_PROFILE]));

            await loadProfiles(TEST_USER_ID);
            expect(meta.size).toBe(0);
        });
    });
});

describe('needsActiveProfileUpdate', () => {
    const profile = (id: string, is_active: boolean) => ({ id, is_active });

    it('profil déjà seul actif : aucune écriture', () => {
        expect(needsActiveProfileUpdate([profile('p1', true)], 'p1')).toBe(false);
        expect(needsActiveProfileUpdate([profile('p1', true), profile('p2', false)], 'p1')).toBe(false);
    });

    it('profil pas encore actif, ou un autre encore actif : écriture', () => {
        expect(needsActiveProfileUpdate([profile('p1', false)], 'p1')).toBe(true);
        expect(needsActiveProfileUpdate([profile('p1', true), profile('p2', true)], 'p1')).toBe(true);
        expect(needsActiveProfileUpdate([profile('p1', true), profile('p2', false)], 'p2')).toBe(true);
    });
});
