/**
 * preferencesPush.ts — Envoi immédiat d'une préférence vers le cloud (fire-and-forget)
 */

import { supabase } from '../../supabaseClient';
import { canSync, getCurrentSyncUserId } from '../syncState';
import { sendInBackground } from './sendInBackground';
import { serverNow } from '../serverClock';

/**
 * Fire-and-forget upsert immédiat d'une préférence vers Supabase.
 * Appelé par preferencesService.setPreference() après chaque écriture locale, avec la date de cette
 * écriture : à l'heure du serveur, pas de l'appareil (sync/serverClock.ts).
 */
export function pushPreferenceToCloud(key: string, value: string, updatedAt: number = serverNow()): void {
  if (!canSync()) return;

  const userId = getCurrentSyncUserId()!;
  sendInBackground(
    supabase
      .from('user_preferences')
      .upsert(
        { user_id: userId, key, value, updated_at: new Date(updatedAt).toISOString() },
        { onConflict: 'user_id,key' }
      ),
    'preference upsert',
  );
}
