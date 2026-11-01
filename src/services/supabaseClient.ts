/**
 * Supabase Client — Singleton
 *
 * Point d'entrée unique pour la connexion Supabase.
 * Utilisé par : SupabaseAuthContext (auth) + tmdbApi (proxy JWT)
 *
 * Session : coffre Android sur Android (voir authStorage.ts), localStorage ailleurs.
 */

import { createClient } from '@supabase/supabase-js';
import { authStorageForPlatform, supabaseStorageKey } from './authStorage';
import { trackAuthEvent } from './authSessionWatch';
import { createAuthGuardedFetch } from './authRefreshGuard';
import { createServerClockFetch } from './sync/serverClock';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[Supabase] FATAL: VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant dans .env'
  );
}

/** Clé de la session (`sb-<projet>-auth-token`), identique à celle que Supabase choisit par défaut. */
export const SUPABASE_STORAGE_KEY = supabaseStorageKey(SUPABASE_URL);

const authStorage = authStorageForPlatform();

async function readStoredSessionForDiagnostics(): Promise<string | null> {
  if (authStorage) return authStorage.peekItem(SUPABASE_STORAGE_KEY);
  return localStorage.getItem(SUPABASE_STORAGE_KEY);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: SUPABASE_STORAGE_KEY,
    ...(authStorage ? { storage: authStorage } : {}),
  },
  // Renouvellement : seul un vrai refus du serveur met fin à la session (authRefreshGuard.ts).
  // La session enregistrée n'est lue que sur un refus, pour dater son dernier renouvellement.
  // Au passage, l'heure du serveur est apprise sur les réponses (sync/serverClock.ts)
  global: {
    fetch: createAuthGuardedFetch(createServerClockFetch(), { readStoredSession: readStoredSessionForDiagnostics }),
  },
});

// Branché avant le premier renouvellement du démarrage (voir authSessionWatch.ts)
supabase.auth.onAuthStateChange((event) => trackAuthEvent(event));
