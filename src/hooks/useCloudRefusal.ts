/**
 * useCloudRefusal — vrai tant qu'un envoi vers le cloud reste refusé par la base pour une borne
 * dépassée (services/sync/cloudRefusal.ts).
 */

import { useSyncExternalStore } from 'react';
import { hasCloudRefusal, subscribeCloudRefusal } from '../services/sync/cloudRefusal';

export function useCloudRefusal(): boolean {
  return useSyncExternalStore(subscribeCloudRefusal, hasCloudRefusal);
}
