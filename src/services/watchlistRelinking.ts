/**
 * Watchlist Re-linking Service
 * 
 * Re-maps watchlist stream_id values using tmdb_id as the pivot.
 * Triggered automatically by data (provider_hash mismatch or dead stream_id),
 * NOT by a "provider change" flag.
 * 
 * Uses LightIndexes reverse maps (moviesByTmdb / seriesByTmdb)
 * which are already available after ingestion.
 */

import type { LightIndexes } from '../types/lightIndex';
import { getDatabase } from './dbCore';
import { forgetForCurrentAccount, watchlistKey } from './sync/syncBaseline';
import { devLog } from '../utils/devLog';
import { WATCHLIST_EVENT } from './eventConstants';
import { createLogger } from '../utils/logger';

const log = createLogger('Watchlist');

// ============================================================================
// TYPES
// ============================================================================

interface WatchlistRow {
    stream_id: number;
    tmdb_id: number;
    type: 'movie' | 'series';
    updated_at: number;
}

interface RelinkResult {
    relinked: number;
    orphaned: number;
    /** Items that were re-linked — to be pushed to cloud via pushWatchlistUpdates */
    relinkedItems: RelinkedItem[];
}

interface RelinkedItem {
    tmdb_id: number;
    media_type: 'movie' | 'series';
    stream_id: number;
    provider_hash: string;
}


/** Déplacement d'une ligne de Ma liste vers le numéro que le catalogue actuel donne à son titre */
interface Move {
    row: WatchlistRow;
    target: number;
}

const rowKey = (streamId: number, type: WatchlistRow['type']) => `${streamId}:${type}`;
const titleKey = (row: Pick<WatchlistRow, 'tmdb_id' | 'type'>) => `${row.tmdb_id}:${row.type}`;

// ============================================================================
// CORE
// ============================================================================

/**
 * Re-link watchlist stream_id based on provider_hash and lightIndexes.
 *
 * For each watchlist item with tmdb_id > 0:
 * 1. provider_hash ≠ currentHash → re-link via tmdb_id (provider changed)
 * 2. provider_hash == currentHash but stream_id not in lightIndexes → re-link (stream moved)
 * 3. Otherwise → OK, nothing to do
 *
 * Items without tmdb_id (= 0) are skipped.
 *
 * Réécriture sûre :
 * - une seule ligne par titre avant la re-liaison (les doublons venus de plusieurs appareils sont
 *   retirés, on garde celle déjà au bon numéro, sinon la plus récente) ;
 * - chaque ligne est visée par son (stream_id, type) exact et passe d'abord par un numéro provisoire
 *   négatif : deux titres qui s'échangent leurs numéros (A 100 → 200, B 200 → 100 ou 300) restent
 *   tous les deux dans Ma liste ;
 * - un titre déjà au bon numéro n'est jamais écrasé par un autre qui réclamerait le même numéro ;
 * - un titre absent du catalogue (« Introuvable ») assis sur le numéro visé n'est jamais effacé :
 *   il passe sur un numéro provisoire négatif, où il reste affiché « Introuvable » jusqu'à ce que le
 *   catalogue retrouve son titre. Seule une ligne sans TMDB, qui ne
 *   désigne que « le titre à ce numéro », est remplacée par le titre qui prend ce numéro ;
 * - une erreur sur un titre n'arrête pas les autres ; le titre garde son ancien numéro et n'est pas
 *   envoyé au cloud. Une ligne restée sur un numéro provisoire (arrêt brutal) est réparée au passage
 *   suivant ;
 * - aucun numéro ≤ 0 n'est renvoyé pour le cloud.
 *
 * @param lightIndexes — current catalog indexes (after ingestion)
 * @param currentHash — SHA256 of current provider host
 * @param cloudItems — watchlist items from cloud with their provider_hash
 */
export async function relinkWatchlistStreamIds(
    lightIndexes: LightIndexes,
    currentHash: string,
    cloudItems?: { tmdb_id: number; type: 'movie' | 'series'; provider_hash: string | null }[],
    options: { notify?: boolean; isStillCurrent?: () => boolean } = {},
): Promise<RelinkResult> {
    const isStillCurrent = options.isStillCurrent ?? (() => true);
    const db = await getDatabase();
    const allRows = await db.select<WatchlistRow[]>(
        'SELECT stream_id, tmdb_id, type, updated_at FROM watchlist'
    );
    const titled = allRows.filter((row) => row.tmdb_id > 0);

    // Session fermée avant la re-liaison (déconnexion, autre compte) : la base ouverte peut être celle
    // du compte suivant, rien n'y est réécrit. Une fois commencée, les
    // écritures passent par la connexion prise ici, celle du bon compte : elles vont au bout (une
    // re-liaison coupée en deux laisserait des titres sur un numéro provisoire).
    if (titled.length === 0 || !isStillCurrent()) {
        devLog('data', '🔗 No watchlist items to re-link');
        return { relinked: 0, orphaned: 0, relinkedItems: [] };
    }

    // Build a lookup for cloud provider_hash by (tmdb_id, type)
    const cloudHashMap = new Map<string, string | null>();
    if (cloudItems) {
        for (const ci of cloudItems) {
            cloudHashMap.set(`${ci.tmdb_id}:${ci.type}`, ci.provider_hash);
        }
    }

    /** Numéro du titre dans le catalogue actuel ; null si le titre n'y est plus (ou numéro invalide) */
    const targetOf = (row: WatchlistRow): number | null => {
        const reverseMap = row.type === 'movie' ? lightIndexes.moviesByTmdb : lightIndexes.seriesByTmdb;
        const id = reverseMap.get(row.tmdb_id)?.id;
        return typeof id === 'number' && id > 0 ? id : null;
    };

    let changed = false;
    const run = async (label: string, sql: string, params: unknown[]): Promise<boolean> => {
        try {
            await db.execute(sql, params);
            changed = true;
            return true;
        } catch (err) {
            log.warn(`Re-link: ${label} failed:`, err);
            return false;
        }
    };

    // 1. Une ligne par titre
    const byTitle = new Map<string, WatchlistRow[]>();
    for (const row of titled) {
        const group = byTitle.get(titleKey(row));
        if (group) group.push(row);
        else byTitle.set(titleKey(row), [row]);
    }
    const removed = new Set<WatchlistRow>();
    for (const group of byTitle.values()) {
        if (group.length < 2) continue;
        const target = targetOf(group[0]);
        const keep = group.find((row) => row.stream_id === target)
            ?? group.reduce((best, row) => (row.updated_at > best.updated_at ? row : best));
        for (const row of group) {
            if (row === keep) continue;
            const ok = await run('duplicate removal', 'DELETE FROM watchlist WHERE stream_id = ? AND type = ?', [row.stream_id, row.type]);
            if (ok) removed.add(row);
        }
    }
    const rows = allRows.filter((row) => !removed.has(row));
    const items = titled.filter((row) => !removed.has(row));

    // 2. Ce que chaque titre doit devenir
    let orphaned = 0;
    let moves: Move[] = [];
    const providerOnly = new Set<WatchlistRow>(); // bon numéro, fournisseur à mettre à jour dans le cloud
    for (const item of items) {
        const target = targetOf(item);
        if (target === null) {
            orphaned++; // Content not found in current provider
            continue;
        }
        if (target !== item.stream_id) {
            moves.push({ row: item, target });
        } else if ((cloudHashMap.get(titleKey(item)) ?? null) !== currentHash) {
            providerOnly.add(item);
        }
    }

    // 3. Numéros disputés : un titre à sa place (ou qui ne peut pas bouger) n'est jamais écrasé, et
    //    deux titres ne visent jamais le même numéro. Recalcul jusqu'à stabilité, car un
    //    déplacement abandonné garde sa ligne à l'ancien numéro, peut-être visé par un autre.
    const stale = new Map<string, WatchlistRow>(); // lignes sans TMDB à remplacer
    const aside = new Map<string, WatchlistRow>(); // titres « Introuvable » à écarter, jamais effacés
    for (;;) {
        const moving = new Set(moves.map((m) => m.row));
        const stationary = new Map<string, WatchlistRow>();
        for (const row of rows) if (!moving.has(row)) stationary.set(rowKey(row.stream_id, row.type), row);

        const claimed = new Set<string>();
        const accepted: Move[] = [];
        stale.clear();
        aside.clear();
        for (const move of moves) {
            const key = rowKey(move.target, move.row.type);
            const occupant = stationary.get(key);
            const occupantIsTitle = occupant !== undefined && occupant.tmdb_id > 0 && targetOf(occupant) !== null;
            if (claimed.has(key) || occupantIsTitle) {
                devLog('data', '🔗 Watchlist re-link skipped (number already taken)', { tmdb_id: move.row.tmdb_id, target: move.target });
                continue;
            }
            claimed.add(key);
            if (occupant) (occupant.tmdb_id > 0 ? aside : stale).set(key, occupant);
            accepted.push(move);
        }
        if (accepted.length === moves.length) break;
        moves = accepted;
    }

    // 4. Écriture : lignes sans TMDB retirées, titres « Introuvable » écartés sur un numéro provisoire
    //    négatif, puis chaque titre déplacé passe par un numéro provisoire négatif pour libérer tous
    //    les anciens numéros avant de prendre les nouveaux.
    const forgotten: string[] = [];
    for (const row of stale.values()) {
        const ok = await run('stale row removal', 'DELETE FROM watchlist WHERE stream_id = ? AND type = ?', [row.stream_id, row.type]);
        if (ok) forgotten.push(watchlistKey(row.tmdb_id, row.stream_id, row.type));
    }
    // Retrait décidé par la re-liaison, pas par l'utilisateur : la synchro suivante ne le propage pas
    // au cloud (dernier accord oublié, sync/syncBaseline.ts)
    await forgetForCurrentAccount('watchlist', forgotten);
    let nextProvisional = rows.reduce((min, row) => Math.min(min, row.stream_id), 0) - 1;
    // Un écart en échec laisse le titre à sa place : le déplacement qui visait son numéro échoue
    // alors (numéro pris) et revient à l'ancien numéro, rien n'est perdu.
    for (const row of aside.values()) {
        await run(`set aside tmdb_id=${row.tmdb_id}`,
            'UPDATE watchlist SET stream_id = ? WHERE stream_id = ? AND type = ? AND tmdb_id = ?',
            [nextProvisional--, row.stream_id, row.type, row.tmdb_id]);
    }
    const parked: (Move & { provisional: number })[] = [];
    for (const move of moves) {
        const provisional = nextProvisional--;
        const ok = await run(`park tmdb_id=${move.row.tmdb_id}`,
            'UPDATE watchlist SET stream_id = ? WHERE stream_id = ? AND type = ?',
            [provisional, move.row.stream_id, move.row.type]);
        if (ok) parked.push({ ...move, provisional });
    }
    const moved = new Set<WatchlistRow>();
    for (const move of parked) {
        const ok = await run(`relink tmdb_id=${move.row.tmdb_id}`,
            'UPDATE watchlist SET stream_id = ? WHERE stream_id = ? AND type = ?',
            [move.target, move.provisional, move.row.type]);
        if (ok) {
            moved.add(move.row);
        } else {
            // Retour à l'ancien numéro ; s'il est déjà repris, la ligne reste provisoire et sera
            // réparée à la prochaine re-liaison (jamais envoyée au cloud entre-temps).
            await run(`restore tmdb_id=${move.row.tmdb_id}`,
                'UPDATE watchlist SET stream_id = ? WHERE stream_id = ? AND type = ?',
                [move.row.stream_id, move.provisional, move.row.type]);
        }
    }
    const targets = new Map(moves.map((m) => [m.row, m.target]));

    // 5. Ce qui part au cloud, dans l'ordre de Ma liste
    const relinkedItems: RelinkedItem[] = [];
    for (const item of items) {
        if (!moved.has(item) && !providerOnly.has(item)) continue;
        relinkedItems.push({
            tmdb_id: item.tmdb_id,
            media_type: item.type,
            stream_id: targets.get(item) ?? item.stream_id,
            provider_hash: currentHash,
        });
    }
    const relinked = relinkedItems.length;

    devLog('data', '🔗 Watchlist re-linked', { total: items.length, relinked, orphaned, duplicates: removed.size });
    // stream_id réécrits : « Ma liste » en mémoire (watchlistHydration) et les cartes se mettent à jour.
    // `notify: false` : l'appelant prévient lui-même, au moment où il installe le catalogue qui va
    // avec (catalogReconcile.ts), pour que l'écran ne change qu'une fois
    if (changed && options.notify !== false) window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
    return { relinked, orphaned, relinkedItems };
}
