/**
 * Contrôles de l'écran Compte, sans React : saisie vérifiée avant tout appel au serveur, et mot de
 * passe actuel vérifié par une reconnexion avant toute modification du compte.
 * Les fonctions de saisie rendent la clé de traduction de l'erreur, ou `null` si tout va bien.
 */

import { supabase } from '../../../services/supabaseClient';
import { isPasswordLongEnough } from '../../../utils/passwordPolicy';
import { authErrorKey, isWrongPasswordError, type AuthErrorKey } from '../../../services/authErrors';
import { createLogger } from '../../../utils/logger';

const log = createLogger('Account');

/** Clés de traduction (espace `settings`) des erreurs de saisie. */
export type AccountInputError =
  | 'account_current_password_required'
  | 'account_password_min_length'
  | 'account_passwords_no_match'
  | 'account_email_invalid';

export function passwordChangeError(current: string, next: string, confirm: string): AccountInputError | null {
  if (!current) return 'account_current_password_required';
  if (!isPasswordLongEnough(next)) return 'account_password_min_length';
  if (next !== confirm) return 'account_passwords_no_match';
  return null;
}

export function emailChangeError(password: string, newEmail: string): AccountInputError | null {
  if (!password) return 'account_current_password_required';
  if (!newEmail.trim() || !newEmail.includes('@')) return 'account_email_invalid';
  return null;
}

/**
 * Reconnexion avec le mot de passe saisi. Faux seulement si Supabase refuse le mot de passe : hors
 * ligne ou après trop d'essais, le SDK ne lève pas, il rend l'erreur, et l'app disait « mot de passe
 * actuel incorrect » alors qu'il était juste. Ces erreurs sont levées pour que l'appelant affiche
 * la vraie raison (authErrorMessageKey).
 *
 * La reconnexion ouvre une session neuve, qui devient celle de l'app : elle est gardée, car la
 * suppression du compte exige une connexion de moins de 10 minutes (supabase/functions/_shared/
 * recentSignIn.ts). L'ancienne session de cet appareil est alors fermée, et elle seule : sinon
 * chaque vérification laissait une session orpheline sur le serveur.
 */
export async function isCurrentPasswordValid(email: string | undefined, password: string): Promise<boolean> {
  const { data: before } = await supabase.auth.getSession();
  const previousToken = before.session?.access_token;
  const { error } = await supabase.auth.signInWithPassword({ email: email || '', password });
  if (error) {
    if (isWrongPasswordError(error)) return false;
    throw error;
  }
  // Pas attendue : son résultat ne change rien, et un réseau lent ne retient pas le bouton
  if (previousToken) void closeSession(previousToken);
  return true;
}

/**
 * Ferme une session par son jeton, avec `scope: 'local'` : cette session seulement, jamais celles
 * des autres appareils. C'est l'appel que Supabase fait lui-même pour `signOut` ; il ne demande que
 * la clé publique. Un échec ne gêne pas la vérification (le serveur purge les sessions après 90 jours).
 */
async function closeSession(accessToken: string): Promise<void> {
  try {
    const { error } = await supabase.auth.admin.signOut(accessToken, 'local');
    if (error) log.warn('previous session not closed:', error.name, error.status ?? '');
  } catch (err) {
    log.warn('previous session not closed:', err instanceof Error ? err.name : 'unknown');
  }
}

/** Clé de traduction (espace `auth`) d'une erreur du compte reçue pendant une modification */
export function authErrorMessageKey(error: unknown): AuthErrorKey {
  return authErrorKey(error);
}
