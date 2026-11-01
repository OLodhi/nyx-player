/**
 * syncHiddenCategories.ts — Sync ensembliste des catégories masquées au login
 */

import { supabase } from '../supabaseClient';
import { getDatabase } from '../dbCore';
import { getLastProviderHash } from '../preferencesService';
import { reloadHiddenCategoriesFromDb } from '../hiddenCategoriesService';
import type { SyncResult, CloudHiddenCategory } from './syncTypes';
import { fetchAllRows } from './syncFetch';
import { readBaseline, updateBaseline, planMerge, canStillWrite, runExclusive } from './syncBaseline';
import { fitsCloudProviderId } from './cloudLimits';
import { cloudWriteError } from './cloudRefusal';
import { createLogger } from '../../utils/logger';

const log = createLogger('Sync');

/**
 * Sync hidden categories : fusion à trois (local, cloud, dernier accord), comme syncLiveTv.
 */
export function syncHiddenCategories(userId: string, result: SyncResult): Promise<void> {
  return runExclusive('hidden', () => syncHiddenCategoriesNow(userId, result));
}

async function syncHiddenCategoriesNow(userId: string, result: SyncResult): Promise<void> {
  // Dernier accord lu en premier (avant le cloud et le local), voir syncBaseline.readBaseline
  const baseline = await readBaseline(userId, 'hidden');
  const db = await getDatabase();

  // 1. Pull cloud — lu en entier, par pages et dans un ordre stable (limite PostgREST de 1000 lignes)
  const allCloudRows = await fetchAllRows<CloudHiddenCategory>('user_hidden_categories', userId, ['category_type', 'category_id'], 'hiddenCategories');

  const cloudSet = new Set<string>();
  for (const row of allCloudRows) {
    cloudSet.add(`${row.category_id}::${row.category_type}`);
  }

  // 2. Pull local
  const localRows = await db.select<{ category_id: string; type: string }[]>(
    'SELECT category_id, type FROM hidden_categories'
  );

  const localSet = new Set<string>();
  // Catégorie au numéro démesuré : gardée ici, jamais envoyée (la base la refuserait)
  for (const row of localRows) {
    if (fitsCloudProviderId(row.category_id)) localSet.add(`${row.category_id}::${row.type}`);
  }

  // 3. Fusion à trois (sync/syncBaseline.ts) : une catégorie réaffichée sur un autre appareil est
  //    réaffichée ici au lieu d'être renvoyée au cloud ; un envoi raté est rattrapé.
  //    Plus rien n'est écrit si le compte a changé pendant la lecture du cloud.
  const plan = planMerge(localSet, cloudSet, baseline);
  if (!canStillWrite(userId, baseline)) return;
  const split = (key: string) => {
    const at = key.lastIndexOf('::');
    return { category_id: key.slice(0, at), category_type: key.slice(at + 2) };
  };

  // 4. Masquées ailleurs → insérer en local ; réaffichées ailleurs → retirer en local
  for (const key of plan.pullToLocal) {
    const { category_id, category_type } = split(key);
    await db.execute(
      'INSERT OR IGNORE INTO hidden_categories (category_id, type) VALUES (?, ?)',
      [category_id, category_type]
    );
    result.hiddenCategories.pulled++;
  }
  for (const key of plan.removeLocal) {
    const { category_id, category_type } = split(key);
    await db.execute(
      'DELETE FROM hidden_categories WHERE category_id = ? AND type = ?',
      [category_id, category_type]
    );
    result.hiddenCategories.pulled++;
  }

  // 5. Cache mémoire rechargé tout de suite : l'accueil masque ces catégories même si
  //    l'envoi ci-dessous échoue ou tarde
  if (result.hiddenCategories.pulled > 0) {
    await reloadHiddenCategoriesFromDb();
  }

  // Retraits dans le cloud : seulement si rien n'a été effacé ni changé de compte entre-temps
  if (!canStillWrite(userId, baseline)) return;

  // 6. Réaffichées ici sans que le cloud le sache → retirer du cloud (par type, 200 à la fois)
  const removedFromCloud: string[] = [];
  const toRemoveByType = new Map<string, string[]>();
  for (const key of plan.removeCloud) {
    const { category_id, category_type } = split(key);
    toRemoveByType.set(category_type, [...(toRemoveByType.get(category_type) ?? []), category_id]);
  }
  for (const [categoryType, ids] of toRemoveByType) {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { error: delErr } = await supabase
        .from('user_hidden_categories')
        .delete()
        .eq('user_id', userId)
        .eq('category_type', categoryType)
        .in('category_id', chunk);
      if (delErr) log.warn('Hidden category cloud delete failed:', delErr.message);
      else {
        removedFromCloud.push(...chunk.map((id) => `${id}::${categoryType}`));
        result.hiddenCategories.pushed += chunk.length;
      }
    }
  }

  // 7. Masquées ici → push cloud
  const toPush = plan.pushToCloud.map(split);
  if (toPush.length > 0) {
    const CHUNK = 200;
    const providerHash = getLastProviderHash(); // empreinte du fournisseur : sync/syncPurge.ts
    for (let i = 0; i < toPush.length; i += CHUNK) {
      const chunk = toPush.slice(i, i + CHUNK);
      const rows = chunk.map((item) => ({
        user_id: userId,
        category_id: item.category_id,
        category_type: item.category_type,
        provider_hash: providerHash,
      }));

      const { error: upsertErr } = await supabase
        .from('user_hidden_categories')
        .upsert(rows, { onConflict: 'user_id,category_id,category_type' });

      if (upsertErr) throw cloudWriteError('Supabase upsert hiddenCategories chunk', upsertErr);
    }
    result.hiddenCategories.pushed += toPush.length;
  }

  // 8. Dernier accord
  await updateBaseline(userId, 'hidden', {
    generation: baseline.generation,
    set: [...plan.inBoth, ...plan.pullToLocal, ...plan.pushToCloud].map((key) => [key, 0] as [string, number]),
    remove: [...plan.removeLocal, ...removedFromCloud, ...plan.stale],
  });
}
