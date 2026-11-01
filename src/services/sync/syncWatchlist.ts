/**
 * syncWatchlist.ts — Sync ensembliste de la watchlist au login
 */

import { supabase } from '../supabaseClient';
import { getDatabase } from '../dbCore';
import { getLastProviderHash } from '../preferencesService';
import type { SyncResult, CloudWatchlistItem, LocalWatchlistRow } from './syncTypes';
import { isoToMs } from './syncTypes';
import { fetchAllRows } from './syncFetch';
import { WATCHLIST_EVENT } from '../eventConstants';
import { deviceProviderHash, updateWatchlistOrigins, watchlistRowKey } from '../watchlistAvailability';
import { placeWatchlistTitles } from './push/watchlistPlacement';
import { sendInBackground } from './push/sendInBackground';
import type { WatchlistPlacement } from './push/watchlistPlacement';
import { readBaseline, updateBaseline, planMerge, canStillWrite, runExclusive, watchlistKey } from './syncBaseline';
import { cloudWriteError } from './cloudRefusal';
import { createLogger } from '../../utils/logger';

const log = createLogger('Sync');

export function syncWatchlist(userId: string, result: SyncResult): Promise<CloudWatchlistItem[]> {
  return runExclusive('watchlist', () => syncWatchlistNow(userId, result));
}

async function syncWatchlistNow(userId: string, result: SyncResult): Promise<CloudWatchlistItem[]> {
  // Dernier accord lu en premier (avant le cloud et le local), voir syncBaseline.readBaseline
  const baseline = await readBaseline(userId, 'watchlist');
  const db = await getDatabase();

  // 1. Pull cloud
  // Lu en entier, par pages : une réponse tronquée ferait prendre des titres pour des retraits
  const cloudItems = await fetchAllRows<CloudWatchlistItem>('user_watchlist', userId, ['stream_id', 'media_type'], 'watchlist');

  const cloudMap = new Map<string, CloudWatchlistItem>();
  for (const row of (cloudItems || [])) {
    cloudMap.set(`${row.stream_id}:${row.media_type}`, row);
  }

  // 2. Pull local
  const localRows = await db.select<LocalWatchlistRow[]>(
    'SELECT stream_id, tmdb_id, type, added_at, updated_at FROM watchlist'
  );

  const localMap = new Map<string, LocalWatchlistRow>();
  // Titres présents en local à un vrai numéro (un numéro ≤ 0 est une re-liaison interrompue)
  const localTitles = new Map<string, LocalWatchlistRow>();
  for (const row of localRows) {
    localMap.set(`${row.stream_id}:${row.type}`, row);
    const title = `${row.tmdb_id}:${row.type}`;
    if (row.tmdb_id > 0 && row.stream_id > 0 && !localTitles.has(title)) localTitles.set(title, row);
  }
  const cloudTitles = new Map<string, CloudWatchlistItem[]>();
  for (const row of (cloudItems || []) as CloudWatchlistItem[]) {
    if (row.tmdb_id <= 0) continue;
    const title = `${row.tmdb_id}:${row.media_type}`;
    cloudTitles.set(title, [...(cloudTitles.get(title) ?? []), row]);
  }

  // 2b. Fusion à trois (sync/syncBaseline.ts) : un titre retiré sur un autre appareil est retiré
  //     ici au lieu d'être renvoyé au cloud ; un retrait dont l'envoi a échoué est
  //     rattrapé. Un titre se reconnaît à son numéro TMDB, une ligne sans TMDB à son numéro.
  const localKeys = new Set<string>();
  for (const row of localRows) {
    if (row.tmdb_id > 0) localKeys.add(watchlistKey(row.tmdb_id, row.stream_id, row.type));
    else if (row.stream_id > 0) localKeys.add(watchlistKey(0, row.stream_id, row.type));
  }
  const cloudKeys = new Set<string>();
  for (const row of (cloudItems || []) as CloudWatchlistItem[]) {
    cloudKeys.add(watchlistKey(row.tmdb_id, row.stream_id, row.media_type));
  }
  const plan = planMerge(localKeys, cloudKeys, baseline);
  const removeLocal = new Set(plan.removeLocal);
  const removeCloud = new Set(plan.removeCloud);
  // Plus rien n'est écrit si le compte a changé pendant la lecture du cloud
  if (!canStillWrite(userId, baseline)) return (cloudItems || []) as CloudWatchlistItem[];

  // 3. Diff local vs cloud
  //    - Titres du cloud absents du local → insérés en local (appareil neuf, ajout ailleurs)
  //    - Titres locaux absents du cloud (ex: ajouts hors ligne, gardés à la connexion),
  //      on les pousse vers le cloud
  //    - Un titre TMDB se compare par titre, pas par numéro : après une
  //      renumérotation, le même titre peut être à 200 en local et encore à 100 dans le cloud. Il
  //      n'est alors ni ajouté une deuxième fois en local, ni supprimé du cloud : la ligne du cloud
  //      est déplacée au numéro local (placeWatchlistTitles), la re-liaison qui suit fait le reste.
  const toPushCloud: LocalWatchlistRow[] = [];
  const toInsertLocal: CloudWatchlistItem[] = [];

  // Cloud-only → insérer en local
  for (const [key, cloudRow] of cloudMap) {
    if (removeCloud.has(watchlistKey(cloudRow.tmdb_id, cloudRow.stream_id, cloudRow.media_type))) continue;
    const local = localMap.get(key);
    const titleIsLocal = cloudRow.tmdb_id > 0 && localTitles.has(`${cloudRow.tmdb_id}:${cloudRow.media_type}`);
    if (!local && !titleIsLocal) {
      toInsertLocal.push(cloudRow);
    }
  }

  // Local-only sans TMDB → push cloud (rattrapage fire-and-forget échoués), jamais un numéro ≤ 0
  for (const [key, local] of localMap) {
    if (local.tmdb_id <= 0 && !cloudMap.has(key) && local.stream_id > 0
      && !removeLocal.has(watchlistKey(0, local.stream_id, local.type))) {
      toPushCloud.push(local);
    }
  }

  // Titres locaux absents du cloud, ou à un autre numéro, ou en double dans le cloud → cloud au numéro local
  const providerHash = getLastProviderHash();
  const placements: WatchlistPlacement[] = [];
  for (const [title, local] of localTitles) {
    if (removeLocal.has(watchlistKey(local.tmdb_id, local.stream_id, local.type))) continue;
    const inCloud = cloudTitles.get(title) ?? [];
    if (inCloud.length === 1 && inCloud[0].stream_id === local.stream_id) continue;
    placements.push({ tmdb_id: local.tmdb_id, media_type: local.type, stream_id: local.stream_id, provider_hash: providerHash });
  }

  // 3b. Deduplicate by (tmdb_id, media_type) — keep only the most recent entry
  // The cloud PK is (user_id, stream_id, media_type), so the same tmdb_id can appear
  // with different stream_ids (e.g. added under different providers). This causes
  // UNIQUE constraint violations during relink when both resolve to the same stream_id.
  // (Titres absents du local seulement : la ligne gardée est insérée en local juste après.)
  const deduped = new Map<string, CloudWatchlistItem>();
  const cloudDuplicates: CloudWatchlistItem[] = [];

  for (const item of toInsertLocal) {
    if (item.tmdb_id <= 0) {
      // No tmdb_id → can't deduplicate, insert as-is (keyed by stream_id)
      deduped.set(`notmdb:${item.stream_id}:${item.media_type}`, item);
      continue;
    }
    const dedupKey = `${item.tmdb_id}:${item.media_type}`;
    const existing = deduped.get(dedupKey);
    if (existing) {
      // Keep the most recent one (by updated_at)
      const existingTs = isoToMs(existing.updated_at);
      const newTs = isoToMs(item.updated_at);
      if (newTs > existingTs) {
        cloudDuplicates.push(existing);
        deduped.set(dedupKey, item);
      } else {
        cloudDuplicates.push(item);
      }
    } else {
      deduped.set(dedupKey, item);
    }
  }

  const dedupedItems = Array.from(deduped.values());

  // 4. Apply local inserts (deduplicated)
  for (const cloudRow of dedupedItems) {
    const addedMs = isoToMs(cloudRow.added_at);
    const updatedMs = isoToMs(cloudRow.updated_at);

    await db.execute(
      `INSERT OR REPLACE INTO watchlist (stream_id, tmdb_id, type, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [cloudRow.stream_id, cloudRow.tmdb_id, cloudRow.media_type, addedMs, updatedMs]
    );
    result.watchlist.pulled++;
  }
  // Origine des titres reçus : un titre ajouté ailleurs chez un autre fournisseur garde un numéro qui
  // ne vaut rien ici tant que la re-liaison ne l'a pas déplacé (watchlistAvailability.ts)
  if (dedupedItems.length > 0) {
    const deviceHash = await deviceProviderHash();
    await updateWatchlistOrigins(dedupedItems.map((row) => [
      watchlistRowKey(row.stream_id, row.media_type),
      row.provider_hash && deviceHash && row.provider_hash !== deviceHash ? row.provider_hash : null,
    ] as const), { accountId: userId });
  }

  // 4b. Cleanup cloud duplicates (fire-and-forget — non-blocking)
  // Ne vise que la ligne en double : son numéro, son type et son titre
  if (cloudDuplicates.length > 0) {
    for (const dup of cloudDuplicates) {
      sendInBackground(
        supabase
          .from('user_watchlist')
          .delete()
          .eq('user_id', userId)
          .eq('stream_id', dup.stream_id)
          .eq('media_type', dup.media_type)
          .eq('tmdb_id', dup.tmdb_id),
        'watchlist dedup cleanup',
      );
    }
    log.info(`Cleaned ${cloudDuplicates.length} cloud watchlist duplicates (same tmdb_id, different stream_id)`);
  }

  // 4c. Retirés ailleurs → retirer en local (toutes les lignes du titre)
  for (const key of removeLocal) {
    const row = localRows.find((r) => watchlistKey(r.tmdb_id, r.stream_id, r.type) === key && (r.tmdb_id > 0 || r.stream_id > 0));
    if (!row) continue;
    if (row.tmdb_id > 0) {
      await db.execute('DELETE FROM watchlist WHERE tmdb_id = ? AND type = ?', [row.tmdb_id, row.type]);
    } else {
      await db.execute('DELETE FROM watchlist WHERE stream_id = ? AND type = ? AND tmdb_id = ?', [row.stream_id, row.type, row.tmdb_id]);
    }
    result.watchlist.pulled++;
  }

  // Retraits dans le cloud : seulement si rien n'a été effacé ni changé de compte entre-temps
  if (!canStillWrite(userId, baseline)) return (cloudItems || []) as CloudWatchlistItem[];

  // 4d. Retirés ici sans que le cloud le sache → retirer du cloud (chaque ligne du titre, exactement)
  const cloudDeleteFailed = new Set<string>();
  for (const cloudRow of (cloudItems || []) as CloudWatchlistItem[]) {
    const key = watchlistKey(cloudRow.tmdb_id, cloudRow.stream_id, cloudRow.media_type);
    if (!removeCloud.has(key)) continue;
    const { error: delErr } = await supabase
      .from('user_watchlist')
      .delete()
      .eq('user_id', userId)
      .eq('stream_id', cloudRow.stream_id)
      .eq('media_type', cloudRow.media_type)
      .eq('tmdb_id', cloudRow.tmdb_id);
    if (delErr) {
      log.warn('Cloud watchlist delete failed:', delErr.message);
      cloudDeleteFailed.add(key); // une ligne du titre reste dans le cloud : on réessaiera
    }
  }
  const removedFromCloud = [...removeCloud].filter((key) => !cloudDeleteFailed.has(key));
  result.watchlist.pushed += removedFromCloud.length;

  // 5. Push to cloud (rattrapage) — include provider_hash
  const placedKeys: string[] = [];
  // Titres retirés provisoirement du cloud pour dénouer un échange de numéros : oubliés du dernier
  // accord sans arrêter cette synchro (elle tient le verrou de Ma liste), et jamais remis dans le
  // dernier accord par l'étape 6 s'ils ne sont pas revenus dans le cloud
  const liftedKeys = new Set<string>();
  if (placements.length > 0) {
    result.watchlist.pushed += await placeWatchlistTitles(userId, placements, (item) => {
      placedKeys.push(watchlistKey(item.tmdb_id, item.stream_id, item.media_type));
    }, (key) => {
      liftedKeys.add(key);
      return updateBaseline(userId, 'watchlist', { remove: [key] });
    });
  }
  const lostInCloud = (key: string) => liftedKeys.has(key) && !placedKeys.includes(key);
  if (toPushCloud.length > 0) {
    const rows = toPushCloud.map((local) => ({
      user_id: userId,
      tmdb_id: local.tmdb_id,
      media_type: local.type,
      stream_id: local.stream_id,
      provider_hash: providerHash,
    }));

    const { error: upsertErr } = await supabase
      .from('user_watchlist')
      .upsert(rows, { onConflict: 'user_id,stream_id,media_type' });

    if (upsertErr) throw cloudWriteError('Supabase upsert watchlist', upsertErr);
    result.watchlist.pushed += toPushCloud.length;
  }

  // 6. Dernier accord : titres désormais des deux côtés (déjà communs, copiés ici, placés dans le
  //    cloud), titres qui ne sont plus nulle part. Un titre ajouté ici mais pas placé (numéro pris
  //    dans le cloud) n'y entre pas : il sera renvoyé à la synchro suivante.
  const pulledKeys = dedupedItems.map((row) => watchlistKey(row.tmdb_id, row.stream_id, row.media_type));
  const pushedKeys = toPushCloud.map((row) => watchlistKey(0, row.stream_id, row.type));
  await updateBaseline(userId, 'watchlist', {
    generation: baseline.generation,
    set: [...plan.inBoth, ...pulledKeys, ...placedKeys, ...pushedKeys]
      .filter((key) => !lostInCloud(key))
      .map((key) => [key, 0] as [string, number]),
    remove: [...removeLocal, ...removedFromCloud, ...plan.stale],
  });

  // Notify UI si des changements ont eu lieu
  if (result.watchlist.pulled > 0 || result.watchlist.pushed > 0) {
    window.dispatchEvent(new CustomEvent(WATCHLIST_EVENT));
  }

  return (cloudItems || []) as CloudWatchlistItem[];
}
