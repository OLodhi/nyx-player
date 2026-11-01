/**
 * Stockage de la session Supabase (jeton d'accès + jeton de renouvellement).
 *
 * Android : la session vit dans le coffre du plugin nyx-android (Keystore, écriture sur disque
 * confirmée avant de rendre la main), et non plus dans le localStorage du WebView.
 * Pourquoi : Supabase remplace le jeton de renouvellement à chaque renouvellement (l'ancien est
 * aussitôt invalidé côté serveur). Le WebView Android n'écrit son localStorage sur disque qu'en
 * différé : si l'app est tuée juste après un renouvellement (balayée des apps récentes, arrêtée par
 * le système, mise à jour de l'APK), elle relit au lancement suivant un jeton que le serveur a déjà
 * remplacé, et Supabase répond « Invalid Refresh Token: Refresh Token Not Found » : déconnexion.
 * Avec le coffre, `setItem` ne se termine qu'une fois la nouvelle session sur disque, et Supabase
 * attend cette fin avant d'annoncer le renouvellement.
 *
 * Windows et navigateur : rien ne change (localStorage par défaut de Supabase).
 */

import type { SupportedStorage } from '@supabase/supabase-js';
import { invoke } from '@tauri-apps/api/core';
import * as Sentry from '@sentry/react';
import { isAndroid } from '../utils/platform';
import { createLogger } from '../utils/logger';

const log = createLogger('authStorage');

/** Préfixe des entrées du coffre Android réservées à la session Supabase. */
const SECURE_PREFIX = 'supabase-auth::';

/** Suffixes des entrées que Supabase écrit à côté de la session principale. */
const AUTH_KEY_SUFFIXES = ['', '-code-verifier', '-user'];

const MAX_READ_ATTEMPTS = 3;
const MAX_WRITE_ATTEMPTS = 3;
/** Un coffre durablement en panne n'est signalé à Sentry qu'une fois par lancement. */
let writeFailureReported = false;

/** Clé de session par défaut de Supabase (`sb-<projet>-auth-token`) : même valeur qu'avant, donc rien à migrer sous Windows. */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** Attente maximale d'un réessai d'écriture : un renouvellement en cours fait attendre les autres lectures de Supabase. */
const WRITE_VISIBILITY_WAIT_MS = 10_000;

/** Attend que l'app soit visible (appareil déverrouillé, app au premier plan), au plus `maxMs` si donné. */
function waitUntilVisible(maxMs?: number): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      document.removeEventListener('visibilitychange', onChange);
      clearTimeout(timer);
      resolve();
    };
    const onChange = () => {
      if (document.visibilityState === 'visible') done();
    };
    document.addEventListener('visibilitychange', onChange);
    if (maxMs !== undefined) timer = setTimeout(done, maxMs);
  });
}

async function secureGet(key: string): Promise<string | null> {
  const result = await invoke<{ value: string | null }>('plugin:nyx-android|secure_get', { key: SECURE_PREFIX + key });
  return result?.value ?? null;
}

async function secureSet(key: string, value: string): Promise<void> {
  await invoke('plugin:nyx-android|secure_set', { key: SECURE_PREFIX + key, value });
}

async function secureDelete(key: string): Promise<void> {
  await invoke('plugin:nyx-android|secure_delete', { key: SECURE_PREFIX + key });
}

function readLegacy(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLegacy(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // localStorage indisponible : rien à nettoyer
  }
}

export interface DurableAuthStorage extends SupportedStorage {
  /** Lecture sans effet de bord (ni réessai, ni reprise du localStorage, ni écriture) : diagnostic. */
  peekItem(key: string): Promise<string | null>;
}

/** Stockage en service : la suppression du compte passe par sa file d'écritures. */
let activeStorage: DurableAuthStorage | null = null;

/**
 * Stockage durable de la session pour Android.
 * - Lecture : coffre d'abord ; s'il est vide, reprise d'une session laissée dans le localStorage par
 *   une version précédente (copiée dans le coffre, puis effacée du localStorage).
 * - Coffre momentanément indisponible (démarrage, appareil verrouillé) : on attend que l'app soit
 *   visible et on réessaie. Après 3 échecs, on répond « pas de session » sans rien effacer : l'écran
 *   de connexion s'affiche ce coup-ci et la session reste dans le coffre pour le lancement suivant.
 *   (Lever l'erreur bloquerait l'app : Supabase n'émet alors jamais INITIAL_SESSION.)
 * - Écriture refusée par le coffre : même réessai. Une écriture perdue après un renouvellement
 *   déconnecte à coup sûr plus tard (le serveur a déjà remplacé le jeton enregistré). Après 3 échecs,
 *   la session reste en mémoire : l'app continue avec elle, et elle est enregistrée dès que le coffre
 *   répond de nouveau (à la lecture suivante). Seul un arrêt de l'app avant ce moment la perd.
 */
export function createDurableAuthStorage(): DurableAuthStorage {
  /** Valeurs plus récentes que celles du coffre (écriture en cours ou refusée) ; perdues si l'app s'arrête. */
  const unsaved = new Map<string, string>();
  /** Écritures et suppressions du coffre, une à la fois et dans l'ordre : une session enregistrée en
   *  retard ne peut ni remplacer une plus récente, ni réapparaître après une déconnexion. */
  let writes: Promise<void> = Promise.resolve();
  const inOrder = (write: () => Promise<void>): Promise<void> => {
    const run = writes.then(write);
    writes = run.catch(() => {});
    return run;
  };

  /** Enregistre une valeur restée en mémoire ; un nouvel échec la garde pour la fois suivante. */
  const saveUnsaved = (key: string) => inOrder(async () => {
    const value = unsaved.get(key);
    if (value === undefined) return; // remplacée ou effacée entre-temps
    try {
      await secureSet(key, value);
      if (unsaved.get(key) === value) unsaved.delete(key);
      removeLegacy(key);
    } catch {
      // Toujours indisponible : nouvel essai à la prochaine lecture
    }
  });

  const storage: DurableAuthStorage = {
    async peekItem(key: string): Promise<string | null> {
      return unsaved.get(key) ?? secureGet(key);
    },

    async getItem(key: string): Promise<string | null> {
      const pending = unsaved.get(key);
      if (pending !== undefined) {
        // Enregistrement lancé sans l'attendre : la lecture n'attend pas un réessai en cours
        void saveUnsaved(key);
        return pending;
      }
      for (let attempt = 1; ; attempt++) {
        try {
          const stored = await secureGet(key);
          if (stored !== null) return stored;
          break;
        } catch (e) {
          log.warn(`Coffre indisponible (essai ${attempt}/${MAX_READ_ATTEMPTS}) :`, e);
          if (attempt >= MAX_READ_ATTEMPTS) return null;
          await waitUntilVisible();
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const legacy = readLegacy(key);
      if (legacy === null) return null;
      await inOrder(async () => {
        // Effacée entre-temps (déconnexion) : rien à reprendre
        if (readLegacy(key) !== legacy) return;
        try {
          await secureSet(key, legacy);
          removeLegacy(key);
        } catch (e) {
          // Copie impossible : on garde la session du localStorage telle quelle, nouvel essai au prochain lancement
          log.warn('Reprise de la session dans le coffre impossible :', e);
        }
      });
      return legacy;
    },

    setItem: (key: string, value: string) => inOrder(async () => {
      // Lue dès maintenant : pendant les réessais, une lecture rend cette valeur, jamais celle du coffre
      unsaved.set(key, value);
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        try {
          await secureSet(key, value);
          if (unsaved.get(key) === value) unsaved.delete(key);
          // Une copie ancienne du localStorage ne doit jamais reprendre le dessus
          removeLegacy(key);
          return;
        } catch (e) {
          log.warn(`Écriture refusée par le coffre (essai ${attempt}/${MAX_WRITE_ATTEMPTS}) :`, e);
          if (attempt < MAX_WRITE_ATTEMPTS) {
            await waitUntilVisible(WRITE_VISIBILITY_WAIT_MS);
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }
      // Valeur gardée en mémoire (déjà posée) ; sans ce signal, la déconnexion qui suivrait un arrêt
      // de l'app resterait inexpliquée
      if (writeFailureReported) return;
      writeFailureReported = true;
      Sentry.captureMessage('Session Supabase non enregistrée sur l\'appareil', {
        level: 'warning',
        tags: { auth_store_entry: key.endsWith('-code-verifier') ? 'code-verifier' : key.endsWith('-user') ? 'user' : 'session' },
      });
    }),

    removeItem: (key: string) => inOrder(async () => {
      unsaved.delete(key);
      removeLegacy(key);
      await secureDelete(key);
    }),
  };
  activeStorage = storage;
  return storage;
}

/** Stockage à donner à Supabase : le coffre sur Android, le défaut de Supabase (localStorage) ailleurs. */
export function authStorageForPlatform(): DurableAuthStorage | undefined {
  return isAndroid() ? createDurableAuthStorage() : undefined;
}

/**
 * Efface la session Supabase du coffre Android (suppression du compte : l'app redémarre sans passer
 * par `signOut`). Ailleurs, la session est dans le localStorage, que la remise à zéro vide déjà.
 */
export async function purgeDurableAuthSession(storageKey: string): Promise<void> {
  if (!isAndroid()) return;
  for (const suffix of AUTH_KEY_SUFFIXES) {
    try {
      // Par la file du stockage en service : une écriture en retard ne peut pas recréer la session
      if (activeStorage) await activeStorage.removeItem(storageKey + suffix);
      else await secureDelete(storageKey + suffix);
    } catch (e) {
      log.warn('Effacement de la session impossible :', e);
    }
  }
}

/** Tests uniquement. */
export function resetAuthStorageReports(): void {
  writeFailureReported = false;
}
