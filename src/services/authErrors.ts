/**
 * Erreurs du compte Nyx traduites. Supabase renvoie des messages techniques en anglais
 * (« Invalid login credentials », « Email not confirmed », « Failed to fetch ») qui étaient affichés
 * tels quels sur le premier écran de l'app. Chaque erreur devient une clé de traduction (espace
 * `auth`), d'après son code quand Supabase en donne un, sinon d'après sa forme (réseau coupé, 429).
 */

export type AuthErrorKey =
  | 'auth_error_invalid_credentials'
  | 'auth_error_email_not_confirmed'
  | 'auth_error_rate_limit'
  | 'auth_error_email_rate_limit'
  | 'auth_error_weak_password'
  | 'auth_error_user_exists'
  | 'auth_error_same_password'
  | 'auth_error_email_invalid'
  | 'auth_error_offline'
  | 'auth_error_server_unavailable'
  | 'auth_error_reauthentication'
  | 'auth_error_signup_disabled'
  | 'auth_error_captcha'
  | 'auth_error_session_expired'
  | 'auth_error_generic';

interface AuthLikeError {
  code?: unknown;
  status?: unknown;
  name?: unknown;
  message?: unknown;
}

const BY_CODE: Record<string, AuthErrorKey> = {
  invalid_credentials: 'auth_error_invalid_credentials',
  email_not_confirmed: 'auth_error_email_not_confirmed',
  over_request_rate_limit: 'auth_error_rate_limit',
  over_email_send_rate_limit: 'auth_error_email_rate_limit',
  weak_password: 'auth_error_weak_password',
  user_already_exists: 'auth_error_user_exists',
  email_exists: 'auth_error_user_exists',
  same_password: 'auth_error_same_password',
  email_address_invalid: 'auth_error_email_invalid',
  // « Changement de mot de passe sécurisé » du serveur : une session récente est exigée
  reauthentication_needed: 'auth_error_reauthentication',
  reauthentication_not_valid: 'auth_error_reauthentication',
  signup_disabled: 'auth_error_signup_disabled',
  captcha_failed: 'auth_error_captcha',
  request_timeout: 'auth_error_server_unavailable',
  // Session expirée ou fermée ailleurs pendant une modification du compte
  session_not_found: 'auth_error_session_expired',
  session_expired: 'auth_error_session_expired',
  refresh_token_not_found: 'auth_error_session_expired',
};

/** Message d'une coupure réseau (navigateur, WebView Android, SDK) */
const OFFLINE_PATTERN = /failed to fetch|network ?error|load failed|networkrequestfailed|fetch failed/i;

/** Clé de traduction d'une erreur du compte Nyx (Supabase), jamais son texte brut */
export function authErrorKey(error: unknown): AuthErrorKey {
  const e = (typeof error === 'object' && error !== null ? error : { message: error }) as AuthLikeError;
  const code = typeof e.code === 'string' ? e.code : '';
  // Propres à la table seulement : un code « constructor » ou « toString » n'en sort pas
  if (Object.prototype.hasOwnProperty.call(BY_CODE, code)) return BY_CODE[code];
  if (e.name === 'AuthSessionMissingError') return 'auth_error_session_expired';
  const message = typeof e.message === 'string' ? e.message : '';
  // Code de toute validation (mot de passe vide, format) : l'adresse seulement si le refus la nomme
  if (code === 'validation_failed') return /email/i.test(message) ? 'auth_error_email_invalid' : 'auth_error_generic';
  // Le SDK range aussi les réponses 502, 503 et 504 dans AuthRetryableFetchError : une panne du
  // serveur ne doit pas faire chercher une coupure de la connexion de l'appareil
  if (e.name === 'AuthRetryableFetchError' && typeof e.status === 'number' && e.status >= 500) return 'auth_error_server_unavailable';
  // Réponse perdue : le SDK la range dans AuthRetryableFetchError (statut 0), ou la laisse passer
  if (e.name === 'AuthRetryableFetchError' || e.name === 'FunctionsFetchError' || OFFLINE_PATTERN.test(message)) {
    return 'auth_error_offline';
  }
  if (e.status === 429) return 'auth_error_rate_limit';
  // Anciennes versions du serveur, sans code : le texte du refus
  if (/invalid login credentials/i.test(message)) return 'auth_error_invalid_credentials';
  if (/email not confirmed/i.test(message)) return 'auth_error_email_not_confirmed';
  return 'auth_error_generic';
}

/** Vrai seulement si Supabase refuse le mot de passe : ni coupure réseau, ni trop d'essais */
export function isWrongPasswordError(error: unknown): boolean {
  return authErrorKey(error) === 'auth_error_invalid_credentials';
}
