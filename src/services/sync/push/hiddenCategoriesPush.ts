/**
 * hiddenCategoriesPush.ts — Envois immédiats d'une catégorie masquée (fire-and-forget)
 *
 * L'envoi de toutes les catégories d'un type d'un coup est dans hiddenCategoriesBatch.ts.
 */

import { supabase } from '../../supabaseClient';
import { canSync, getCurrentSyncUserId } from '../syncState';
import { getLastProviderHash } from '../../preferencesService';
import { currentGeneration } from '../syncBaseline';
import { afterSend } from './afterSend';
import { sendInBackground } from './sendInBackground';
import { fitsCloudProviderId } from '../cloudLimits';

/**
 * Fire-and-forget upsert immédiat d'une catégorie masquée vers Supabase.
 * Sans appelant dans l'app pour l'instant : l'écran des catégories passe par l'envoi groupé
 * (hiddenCategoriesBatch.ts). Gardé, avec ses tests, pour un envoi d'une seule catégorie.
 */
export function pushHiddenCategoryToCloud(
  categoryId: string,
  categoryType: string
): void {
  // Numéro démesuré : gardé sur l'appareil, jamais envoyé (la base le refuserait)
  if (!canSync() || !fitsCloudProviderId(categoryId)) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('hidden');
  sendInBackground(
    supabase
      .from('user_hidden_categories')
      .upsert(
        { user_id: userId, category_id: categoryId, category_type: categoryType, provider_hash: getLastProviderHash() },
        { onConflict: 'user_id,category_id,category_type' }
      ),
    'hidden category upsert',
    () => afterSend(userId, 'hidden', generation, { set: [[`${categoryId}::${categoryType}`, 0]] }),
  );
}

/**
 * Hard DELETE immédiat d'une catégorie masquée de Supabase (fire-and-forget).
 * Sans appelant dans l'app pour l'instant : l'écran des catégories passe par l'envoi groupé
 * (hiddenCategoriesBatch.ts). Gardé, avec ses tests, pour un envoi d'une seule catégorie.
 * Si offline ou erreur, la synchro suivante retire l'élément du cloud (dernier accord, syncBaseline.ts).
 */
export function pushHiddenCategoryDeleteToCloud(
  categoryId: string,
  categoryType: string
): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  const generation = currentGeneration('hidden');
  sendInBackground(
    supabase
      .from('user_hidden_categories')
      .delete()
      .eq('user_id', userId)
      .eq('category_id', categoryId)
      .eq('category_type', categoryType),
    'hidden category delete',
    () => afterSend(userId, 'hidden', generation, { remove: [`${categoryId}::${categoryType}`] }),
  );
}
