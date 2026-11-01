/**
 * profileService.ts — CRUD pour les profils utilisateur (Supabase)
 *
 * Phase 1.5 : mono-profil (auto-provisioning "Profile 1" au premier login).
 * Phase 2+ : multi-profil avec chaque profil ayant ses propres données.
 *
 * La table `user_profiles` est côté Supabase uniquement.
 * Le profil actif est persisté localement via `setMeta('active_profile_id', id)`.
 * La liste des profils est gardée dans la base locale du compte (`cached_profiles`) : sans réseau au
 * démarrage, l'écran des profils s'affiche avec elle au lieu d'une erreur.
 */

import { supabase } from './supabaseClient';
import { getMeta, setMeta, isDatabaseOf } from './dbCore';
import { createLogger } from '../utils/logger';

const log = createLogger('ProfileService');

// ============================================================================
// TYPES
// ============================================================================

export interface UserProfile {
    id: string;
    user_id: string;
    display_name: string;
    avatar_color: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

/** Palette de couleurs par défaut pour les avatars */
const AVATAR_COLORS = ['#F4A8A8', '#A8D8F4', '#A8F4C8', '#F4D8A8', '#D8A8F4'];

// ============================================================================
// CRUD
// ============================================================================

/**
 * Récupère tous les profils de l'utilisateur.
 * @throws Error si la requête Supabase échoue (réseau, RLS, etc.)
 */
export async function getProfiles(userId: string): Promise<UserProfile[]> {
    const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

    if (error) {
        throw new Error(`[ProfileService] getProfiles failed: ${error.message}`);
    }

    return (data ?? []) as UserProfile[];
}

/** Créations du profil par défaut en cours, par compte : un seul appel à Supabase à la fois */
const pendingDefaultProfile = new Map<string, Promise<UserProfile[]>>();

/**
 * Auto-provisionne "Profile 1" si aucun profil n'existe pour l'utilisateur.
 * Retourne la liste complète des profils (1 minimum après exécution).
 *
 * Sans doublon : sur un même appareil, deux appels simultanés partagent la même création ;
 * entre deux appareils, chacun relit la liste après sa création et le moins ancien des deux profils
 * créés en même temps retire le sien (voir `keepOldestDefaultProfile`).
 */
export function ensureDefaultProfile(userId: string): Promise<UserProfile[]> {
    const pending = pendingDefaultProfile.get(userId);
    if (pending) return pending;
    const run = createDefaultProfileIfMissing(userId).finally(() => {
        pendingDefaultProfile.delete(userId);
    });
    pendingDefaultProfile.set(userId, run);
    return run;
}

/** Code Postgres d'une valeur refusée par un index unique */
const UNIQUE_VIOLATION = '23505';

async function createDefaultProfileIfMissing(userId: string): Promise<UserProfile[]> {
    const profiles = await getProfiles(userId);

    if (profiles.length > 0) {
        return profiles;
    }

    // Auto-créer "Profile 1"
    const { data, error } = await supabase
        .from('user_profiles')
        .insert({
            user_id: userId,
            display_name: 'Profile 1',
            avatar_color: AVATAR_COLORS[0],
            is_active: true,
        })
        .select()
        .single();

    if (error) {
        // Refus d'une protection en base contre les doublons (contrainte d'unicité proposée) :
        // un autre appareil vient de créer le profil, on prend le sien
        if (error.code === UNIQUE_VIOLATION) {
            return getProfiles(userId);
        }
        throw new Error(`[ProfileService] ensureDefaultProfile failed: ${error.message}`);
    }

    return keepOldestDefaultProfile(userId, data as UserProfile);
}

/** Le plus ancien d'abord ; à égalité de date, l'identifiant départage, le même sur tous les appareils */
function compareByAge(a: UserProfile, b: UserProfile): number {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Après avoir créé le profil par défaut, vérifie qu'un autre appareil n'en a pas créé un au même
 * moment (il n'y avait aucun profil juste avant, donc tout autre profil vient d'une création
 * simultanée). Le plus ancien est gardé ; si ce n'est pas le nôtre, on retire celui qu'on vient de
 * créer, encore vide. Sans réseau ou si le retrait échoue, on garde le profil créé : l'app reste
 * utilisable, mais le doublon restera visible aux lancements suivants jusqu'au nettoyage prévu avec
 * la contrainte en base. Reste aussi une fenêtre de quelques millisecondes (la date d'une
 * ligne est celle du début de son écriture) où chaque appareil garde le sien : seule la base la ferme.
 */
async function keepOldestDefaultProfile(userId: string, created: UserProfile): Promise<UserProfile[]> {
    let all: UserProfile[];
    try {
        all = await getProfiles(userId);
    } catch (err) {
        log.warn('default profile re-check skipped:', (err as Error).message);
        return [created];
    }
    if (!all.some((p) => p.id === created.id)) all.push(created);
    const oldest = [...all].sort(compareByAge)[0];
    if (oldest.id === created.id) return [created];

    // Sans règle d'accès pour la suppression, Supabase ne supprime rien sans renvoyer d'erreur :
    // la liste des lignes supprimées le révèle
    const { data: removed, error } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', created.id)
        .eq('user_id', userId)
        .select('id');
    if (error) {
        log.warn('duplicate default profile not removed:', error.message);
    } else if (!removed || removed.length === 0) {
        log.warn('duplicate default profile not removed: nothing deleted');
    }
    return [oldest];
}

/**
 * Renomme un profil. Filtré aussi par compte : un profil d'un autre compte n'est jamais visé, même
 * si la règle d'accès de la base venait à manquer.
 */
export async function updateProfileName(
    userId: string,
    profileId: string,
    displayName: string
): Promise<void> {
    const { data, error } = await supabase
        .from('user_profiles')
        .update({
            display_name: displayName,
            updated_at: new Date().toISOString(),
        })
        .eq('id', profileId)
        .eq('user_id', userId)
        .select('id');

    if (error) {
        throw new Error(`[ProfileService] updateProfileName failed: ${error.message}`);
    }
    // Aucune ligne touchée (profil d'un autre compte, ou supprimé) : pas de « profil renommé » trompeur
    if (!data || data.length === 0) {
        throw new Error('[ProfileService] updateProfileName failed: profile not found');
    }
}

/**
 * Vrai si le cloud doit être prévenu du choix de ce profil : il n'y est pas déjà le seul actif.
 * Avec un seul profil (cas actuel), jamais après la première fois.
 */
export function needsActiveProfileUpdate(profiles: Pick<UserProfile, 'id' | 'is_active'>[], profileId: string): boolean {
    return profiles.some((p) => (p.id === profileId) !== p.is_active);
}

/**
 * Marque un profil comme actif et désactive les autres.
 * En v1 mono-profil, il n'y a qu'un seul profil donc l'opération est triviale.
 */
export async function setActiveProfile(
    userId: string,
    profileId: string
): Promise<void> {
    // 1. Désactiver tous les profils du user
    const { error: deactivateErr } = await supabase
        .from('user_profiles')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId);

    if (deactivateErr) {
        throw new Error(`[ProfileService] setActiveProfile deactivate failed: ${deactivateErr.message}`);
    }

    // 2. Activer le profil sélectionné, de ce compte seulement (comme updateProfileName)
    const { error: activateErr } = await supabase
        .from('user_profiles')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', profileId)
        .eq('user_id', userId);

    if (activateErr) {
        throw new Error(`[ProfileService] setActiveProfile activate failed: ${activateErr.message}`);
    }
}

// ============================================================================
// HORS LIGNE
// ============================================================================

const CACHE_KEY = 'cached_profiles';

/** Garde la liste des profils dans la base locale du compte (sans erreur si la base est indisponible) */
async function saveCachedProfiles(userId: string, profiles: UserProfile[]): Promise<void> {
    try {
        if (!isDatabaseOf(userId)) return;
        await setMeta(CACHE_KEY, JSON.stringify(profiles.filter((p) => p.user_id === userId)));
    } catch (err) {
        log.warn('profiles cache not saved:', err);
    }
}

/** Liste des profils gardée en local pour ce compte ([] si aucune) */
async function readCachedProfiles(userId: string): Promise<UserProfile[]> {
    try {
        if (!isDatabaseOf(userId)) return [];
        const raw = await getMeta(CACHE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as UserProfile[];
        return Array.isArray(parsed) ? parsed.filter((p) => p && p.user_id === userId && typeof p.id === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * Profils de l'utilisateur pour l'écran des profils : ceux de Supabase (gardés en local au passage),
 * ou, si Supabase ne répond pas (pas de réseau, serveur indisponible), ceux gardés en local.
 * `offline` vaut true dans ce second cas.
 * @throws l'erreur de Supabase si aucune liste n'a encore été gardée sur cet appareil
 */
export async function loadProfiles(userId: string): Promise<{ profiles: UserProfile[]; offline: boolean }> {
    try {
        const profiles = await ensureDefaultProfile(userId);
        // Copie locale écrite sans l'attendre : si un travail de fond tient la base (synchro, catalogue),
        // l'écriture patiente jusqu'à 5 s (busy_timeout) et l'écran des profils avec elle
        void saveCachedProfiles(userId, profiles);
        return { profiles, offline: false };
    } catch (err) {
        const cached = await readCachedProfiles(userId);
        if (cached.length === 0) throw err;
        log.warn('Supabase unavailable, using local profiles:', (err as Error).message);
        return { profiles: cached, offline: true };
    }
}
