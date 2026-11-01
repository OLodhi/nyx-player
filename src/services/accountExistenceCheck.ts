/**
 * Compte supprimé depuis un autre appareil.
 *
 * Au lancement, Supabase rouvre la session enregistrée sans interroger le serveur tant que son jeton
 * d'accès n'a pas expiré (une heure par défaut) : un compte supprimé ailleurs restait donc utilisable
 * sur un appareil déjà connecté, même après une fermeture complète. Et quand le serveur répond que
 * l'utilisateur n'existe plus (« user_not_found »), Supabase garde la session : il ne l'efface que
 * pour une session introuvable (« session_not_found »).
 *
 * Ici, chaque ouverture de session (lancement, connexion, retour au premier plan) demande au serveur
 * si le compte existe encore. S'il répond clairement que non, l'appareil fait le même nettoyage que
 * celui qui a supprimé le compte (base et identifiants IPTV du compte, session, réglages, puis
 * relance), par la marque de suppression d'accountDeletion.ts : une app fermée au milieu finit le
 * nettoyage au lancement suivant. L'écran de connexion explique ensuite que le compte a été
 * supprimé. Hors ligne, ou si le serveur répond autre chose, rien ne change.
 *
 * Limite : la vérification demande une session encore valable. Un appareil rouvert plus d'une heure
 * après la suppression trouve sa session refusée au renouvellement (« session expirée ») : le compte
 * n'y est plus utilisable, mais ses données locales restent. Un jeton de renouvellement refusé ne
 * prouve pas la suppression (une déconnexion de tous les appareils donne la même réponse) : rien
 * n'est effacé dans ce cas.
 */

import { supabase } from './supabaseClient';
import {
  ACCOUNT_DELETED_NOTICE_KEY,
  confirmAccountDeletion,
  finishPendingAccountDeletion,
  isAccountDeletionPending,
  markAccountDeletionPending,
} from './accountDeletion';
import { createLogger } from '../utils/logger';

const log = createLogger('Account');

/** Écart minimal entre deux vérifications du même compte (Supabase annonce souvent SIGNED_IN) */
const MIN_INTERVAL_MS = 60_000;

let lastCheck: { uid: string; at: number } | null = null;
let running = false;
/** Compte demandé pendant une vérification en cours (changement de compte) : vérifié juste après */
let queued: string | null = null;

/** Réponse du serveur d'authentification : l'utilisateur du jeton n'existe plus. */
export function isDeletedAccountError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'user_not_found';
}

/**
 * Vérifie que le compte de la session existe encore ; sinon, nettoie l'appareil. À appeler hors de
 * l'écouteur `onAuthStateChange` : voir `scheduleAccountExistenceCheck`.
 */
export async function checkAccountStillExists(
  uid: string,
  cleanup: () => Promise<boolean> = finishPendingAccountDeletion,
): Promise<boolean> {
  if (running) {
    queued = uid;
    return true;
  }
  // Suppression déjà en cours sur cet appareil (Réglages, ou nettoyage lancé) : surtout pas un second
  if (isAccountDeletionPending()) return true;
  const now = Date.now();
  if (lastCheck && lastCheck.uid === uid && now - lastCheck.at < MIN_INTERVAL_MS) return true;
  lastCheck = { uid, at: now };
  running = true;
  try {
    // Le serveur est interrogé avec le jeton de CE compte : la réponse ne peut viser que lui
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== uid) return true;
    const { error } = await supabase.auth.getUser(session.access_token);
    if (!error) return true;
    if (!isDeletedAccountError(error)) {
      // Hors ligne, serveur en panne, jeton expiré : on ne conclut rien
      lastCheck = null;
      return true;
    }
    if (isAccountDeletionPending()) return true;
    log.warn('Compte supprimé depuis un autre appareil : nettoyage de cet appareil');
    try {
      localStorage.setItem(ACCOUNT_DELETED_NOTICE_KEY, '1');
    } catch {
      // Stockage indisponible : seul le message de l'écran de connexion manquera
    }
    markAccountDeletionPending(uid);
    confirmAccountDeletion();
    queued = null;
    await cleanup();
    return false;
  } catch (err) {
    lastCheck = null;
    log.warn('Vérification du compte impossible :', err);
    return true;
  } finally {
    running = false;
    const next = queued;
    queued = null;
    if (next) void checkAccountStillExists(next, cleanup);
  }
}

/** Depuis l'écouteur `onAuthStateChange` : la vérification part après lui, sans bloquer Supabase. */
export function scheduleAccountExistenceCheck(uid: string): void {
  setTimeout(() => { void checkAccountStillExists(uid); }, 0);
}

/** Écran de connexion : vrai une seule fois après le nettoyage d'un compte supprimé ailleurs. */
export function consumeAccountDeletedNotice(): boolean {
  try {
    const shown = localStorage.getItem(ACCOUNT_DELETED_NOTICE_KEY) !== null;
    if (shown) localStorage.removeItem(ACCOUNT_DELETED_NOTICE_KEY);
    return shown;
  } catch {
    return false;
  }
}

/** Tests uniquement. */
export function resetAccountExistenceCheck(): void {
  lastCheck = null;
  running = false;
  queued = null;
}
