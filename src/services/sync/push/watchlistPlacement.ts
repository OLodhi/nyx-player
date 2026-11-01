/**
 * watchlistPlacement.ts — Placement des titres de Ma liste dans le cloud (numéros croisés, doublons)
 *
 * Utilisé par les envois de Ma liste (watchlistPush.ts) et par la synchro de Ma liste
 * (syncWatchlist.ts).
 */

import { supabase } from '../../supabaseClient';
import { getCurrentSyncUserId } from '../syncState';
import { forgetForCurrentAccount, watchlistKey } from '../syncBaseline';
import { devLog } from '../../../utils/devLog';
import { createLogger } from '../../../utils/logger';

const log = createLogger('Sync');

/** Code PostgreSQL « valeur déjà prise » : le numéro visé appartient encore à une autre ligne */
const UNIQUE_VIOLATION = '23505';

export type WatchlistPlacement = { tmdb_id: number; media_type: 'movie' | 'series'; stream_id: number; provider_hash: string | null };
type CloudError = { message: string; code?: string };

/**
 * Met chaque titre de Ma liste, dans le cloud, au numéro donné : une seule ligne par titre, sans
 * jamais écraser ni retirer la ligne d'un autre titre.
 *
 * La clé du cloud est (user_id, stream_id, media_type), donc A 100 → 200 échoue tant qu'une autre
 * ligne occupe 200. Chaque titre est mis à jour par (tmdb_id, media_type) ; un titre absent du
 * cloud y est ajouté ; les titres refusés sont retentés après les autres tant qu'un passage fait
 * avancer quelque chose. Si plus rien n'avance, on regarde qui occupe le numéro visé :
 * - le même titre (doublon) : ses autres lignes sont retirées, il garde celle du bon numéro ;
 * - le titre a plusieurs lignes : on garde la plus ancienne, les autres sont retirées ;
 * - un autre titre de ce lot (échange complet A 100 → 200, B 200 → 100) : ce titre est retiré puis
 *   remis au bon numéro une fois les autres placés, avec sa date d'ajout (à défaut, à son ancien
 *   numéro) ;
 * - un titre hors du lot : on n'y touche pas, ce titre garde son ancien numéro dans le cloud.
 * Aucun numéro ≤ 0 n'est envoyé, et plus rien n'est écrit si le compte connecté change en cours de
 * route. Retourne le nombre de titres placés.
 */
export async function placeWatchlistTitles(
  userId: string,
  items: WatchlistPlacement[],
  /** Appelé pour chaque titre désormais présent dans le cloud (dernier accord, syncBaseline.ts) */
  onPlaced?: (item: WatchlistPlacement) => void,
  /**
   * Oublie un titre du dernier accord juste avant son retrait provisoire du cloud.
   * Par défaut forgetForCurrentAccount, qui arrête aussi les synchros de Ma liste en cours : une
   * synchro qui lirait le cloud pendant le retrait prendrait sinon le titre pour un retrait fait
   * ailleurs. La synchro de Ma liste, seule à tourner (runExclusive), passe sa propre fonction.
   */
  forgetLifted: (key: string) => Promise<void> = (key) => forgetForCurrentAccount('watchlist', [key]),
): Promise<number> {
  const table = () => supabase.from('user_watchlist');
  const titleOf = (item: Pick<WatchlistPlacement, 'tmdb_id' | 'media_type'>) => `${item.tmdb_id}:${item.media_type}`;

  const placeOne = async (item: WatchlistPlacement): Promise<CloudError | null> => {
    const { data, error } = await table()
      .update({ stream_id: item.stream_id, provider_hash: item.provider_hash })
      .eq('user_id', userId)
      .eq('tmdb_id', item.tmdb_id)
      .eq('media_type', item.media_type)
      .select('stream_id');
    if (error) return error;
    if (Array.isArray(data) && data.length > 0) return null;
    // Titre absent du cloud : on l'ajoute (refusé si le numéro est pris, jamais écrasé)
    const { error: insertErr } = await table().insert({
      user_id: userId, tmdb_id: item.tmdb_id, media_type: item.media_type,
      stream_id: item.stream_id, provider_hash: item.provider_hash,
    });
    return insertErr;
  };

  /** Titre qui occupe un numéro dans le cloud : son tmdb_id, null si libre, undefined si illisible */
  const occupantOf = async (streamId: number, mediaType: WatchlistPlacement['media_type']) => {
    const { data, error } = await table().select('tmdb_id')
      .eq('user_id', userId).eq('stream_id', streamId).eq('media_type', mediaType);
    if (error) return undefined;
    return ((data ?? []) as { tmdb_id: number }[])[0]?.tmdb_id ?? null;
  };
  /** Lignes du cloud d'un titre, et titre qui occupe le numéro visé */
  const inspect = async (item: WatchlistPlacement) => {
    const own = await table().select('stream_id, added_at')
      .eq('user_id', userId).eq('tmdb_id', item.tmdb_id).eq('media_type', item.media_type);
    const occupantTmdb = await occupantOf(item.stream_id, item.media_type);
    if (own.error || occupantTmdb === undefined) return null;
    return { rows: (own.data ?? []) as { stream_id: number; added_at: string | null }[], occupantTmdb };
  };
  /** Vrai seulement si une ligne a réellement été retirée (un refus des règles d'accès ne renvoie pas d'erreur) */
  const removeRow = async (item: WatchlistPlacement, streamId: number) => {
    const { data, error } = await table().delete()
      .eq('user_id', userId).eq('stream_id', streamId).eq('media_type', item.media_type).eq('tmdb_id', item.tmdb_id)
      .select('stream_id');
    return !error && Array.isArray(data) && data.length > 0;
  };
  /**
   * Vrai si le numéro visé par ce titre est pris par un titre du lot, qui vise un numéro pris par
   * un autre titre du lot… jusqu'à revenir à ce titre : un cycle fermé, que seul un retrait
   * provisoire peut dénouer. Si la chaîne sort du lot, on ne touche à rien.
   */
  const closesCycle = async (item: WatchlistPlacement, batch: Map<string, WatchlistPlacement>) => {
    let current = item;
    const seen = new Set<WatchlistPlacement>([item]);
    for (let step = 0; step < batch.size; step++) {
      const occupant = await occupantOf(current.stream_id, current.media_type);
      if (occupant === undefined || occupant === null) return false;
      if (occupant === item.tmdb_id) return current !== item;
      const next = batch.get(titleOf({ tmdb_id: occupant, media_type: item.media_type }));
      if (!next || seen.has(next)) return false;
      seen.add(next);
      current = next;
    }
    return false;
  };

  let pending = items.filter((item) => item.stream_id > 0);
  type Lifted = { item: WatchlistPlacement; rows: { stream_id: number; added_at: string | null }[]; back: boolean };
  const lifted: Lifted[] = [];
  let placed = 0;

  /** Remet un titre retiré, avec sa date d'ajout, au premier numéro libre de la liste donnée */
  const reinsert = async (entry: Lifted, candidates: number[]) => {
    const addedAt = entry.rows.map((row) => row.added_at).filter((d): d is string => typeof d === 'string').sort()[0];
    for (const streamId of candidates) {
      const { error } = await table().insert({
        user_id: userId, tmdb_id: entry.item.tmdb_id, media_type: entry.item.media_type,
        stream_id: streamId, provider_hash: entry.item.provider_hash, ...(addedAt ? { added_at: addedAt } : {}),
      });
      if (!error) {
        entry.back = true;
        placed++;
        onPlaced?.(entry.item);
        return;
      }
    }
  };
  /** Le compte n'a pas changé depuis le début (déconnexion, autre compte) : sinon on n'écrit plus rien */
  const stillSameAccount = () => getCurrentSyncUserId() === userId;

  // Chaque passe place au moins un titre ou retire une ligne ; la borne protège d'un cloud qui
  // changerait en même temps (autre appareil) ou refuserait les retraits sans le dire.
  const maxPasses = items.length * 3 + 3;
  try {
    for (let pass = 0; pending.length > 0; pass++) {
      if (pass >= maxPasses || !stillSameAccount()) {
        log.warn(`Watchlist cloud: stopped with ${pending.length} titles left (pass ${pass})`);
        break;
      }
      const failed: { item: WatchlistPlacement; error: CloudError }[] = [];
      for (const item of pending) {
        const error = await placeOne(item);
        if (error) failed.push({ item, error });
        else {
          placed++;
          onPlaced?.(item);
        }
      }
      // Un titre retiré revient dès que son numéro est libéré, sans attendre la fin
      for (const entry of lifted) if (!entry.back) await reinsert(entry, [entry.item.stream_id]);

      if (failed.length === 0) break;
      if (failed.length < pending.length) {
        pending = failed.map((f) => f.item);
        continue;
      }

      // Plus rien n'avance : débloquer un titre refusé pour un numéro pris, sans toucher aux autres titres
      const batch = new Map(failed.map((f) => [titleOf(f.item), f.item]));
      let unblocked: WatchlistPlacement | null = null;
      for (const { item, error } of failed) {
        if (error.code !== UNIQUE_VIOLATION) continue;
        const state = await inspect(item);
        if (!state) continue;
        if (state.occupantTmdb === item.tmdb_id) {
          // Doublon du même titre : on garde la ligne déjà au bon numéro
          const others = state.rows.filter((row) => row.stream_id !== item.stream_id);
          if (others.length > 0 && (await Promise.all(others.map((row) => removeRow(item, row.stream_id)))).every(Boolean)) {
            unblocked = item;
            break;
          }
        } else if (state.occupantTmdb === null && state.rows.length > 1) {
          // Plusieurs lignes du même titre : on garde la plus ancienne
          const [, ...extra] = [...state.rows].sort((a, b) => String(a.added_at).localeCompare(String(b.added_at)));
          if ((await Promise.all(extra.map((row) => removeRow(item, row.stream_id)))).every(Boolean)) {
            unblocked = item;
            break;
          }
        } else if (state.occupantTmdb !== null && state.rows.length > 0 && (await closesCycle(item, batch))) {
          // Échange complet avec un autre titre de ce lot : ce titre sort, puis revient au bon numéro.
          // Il est d'abord oublié du dernier accord : si le réseau coupe (ou l'app est fermée) avant
          // son retour, la synchro suivante le renvoie au cloud au lieu de le prendre pour un retrait
          // fait ailleurs et de le supprimer partout. La synchro suivante le
          // remet dans le dernier accord une fois présent des deux côtés.
          await forgetLifted(watchlistKey(item.tmdb_id, item.stream_id, item.media_type));
          const removed = await Promise.all(state.rows.map((row) => removeRow(item, row.stream_id)));
          if (removed.every(Boolean)) {
            lifted.push({ item, rows: state.rows, back: false });
            unblocked = item;
            pending = failed.filter((f) => f.item !== item).map((f) => f.item);
            break;
          }
        }
      }
      if (!unblocked) {
        for (const { item, error } of failed) {
          log.warn(`Watchlist cloud update failed for tmdb_id=${item.tmdb_id}:`, error.message);
        }
        break;
      }
      if (!lifted.some((l) => l.item === unblocked)) pending = failed.map((f) => f.item);
    }
  } finally {
    // Titres retirés pas encore revenus : au bon numéro, sinon à leur ancien numéro, pour ne jamais
    // les perdre. Si le compte a changé, rien n'est écrit : la synchro suivante du compte les remet.
    for (const entry of lifted) {
      if (entry.back || !stillSameAccount()) continue;
      await reinsert(entry, [entry.item.stream_id, ...entry.rows.map((row) => row.stream_id)]);
      if (!entry.back) log.warn(`Watchlist cloud re-insert failed for tmdb_id=${entry.item.tmdb_id}`);
    }
  }
  devLog('sync', `Watchlist cloud: ${placed}/${items.length} titles placed`);
  return placed;
}
