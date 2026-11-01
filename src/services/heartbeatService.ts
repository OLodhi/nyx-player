/**
 * heartbeatService.ts — Ping anonyme fire-and-forget au login
 *
 * Envoie un upsert vers app_heartbeat (Supabase) avec :
 * - app_version : depuis tauri.conf.json via getVersion()
 * - platform : depuis tauri-plugin-os via platform()
 * - last_seen_at : timestamp courant
 *
 * Zéro impact UX : si ça fail, on warn et on continue.
 */

import { supabase } from './supabaseClient';
import { getVersion } from '@tauri-apps/api/app';
import { platform } from '@tauri-apps/plugin-os';
import { createLogger } from '../utils/logger';

const log = createLogger('Heartbeat');

/**
 * Envoie un heartbeat fire-and-forget à Supabase.
 * Appelé une seule fois au login (SIGNED_IN / INITIAL_SESSION).
 */
export async function sendHeartbeat(userId: string): Promise<void> {
  try {
    const appVersion = await getVersion();
    const osPlatform = platform(); // synchrone depuis plugin-os 2

    supabase
      .from('app_heartbeat')
      .upsert(
        {
          user_id: userId,
          app_version: appVersion,
          platform: osPlatform,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .then(
        ({ error }) => {
          if (error) log.warn('upsert failed:', error.message);
        },
        // Requête rejetée (réseau coupé) : même sort qu'une erreur renvoyée, journalisée
        (err: unknown) => log.warn('upsert failed:', err),
      );
  } catch (err) {
    log.warn('skipped:', err);
  }
}
