/**
 * Erreurs du compte Nyx : chaque forme renvoyée par Supabase devient un message traduit, jamais le
 * texte anglais brut (« Invalid login credentials », « Email not confirmed », « Failed to fetch »).
 */
import { describe, it, expect } from 'vitest';
import { authErrorKey, isWrongPasswordError } from '../authErrors';

describe('authErrorKey', () => {
  it.each([
    [{ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, 'auth_error_invalid_credentials'],
    [{ name: 'AuthApiError', status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' }, 'auth_error_email_not_confirmed'],
    [{ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' }, 'auth_error_rate_limit'],
    [{ name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }, 'auth_error_email_rate_limit'],
    [{ name: 'AuthWeakPasswordError', status: 422, code: 'weak_password', message: 'Password should be…' }, 'auth_error_weak_password'],
    [{ name: 'AuthApiError', status: 422, code: 'user_already_exists', message: 'User already registered' }, 'auth_error_user_exists'],
    [{ name: 'AuthApiError', status: 422, code: 'same_password', message: 'New password should be different' }, 'auth_error_same_password'],
    [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'auth_error_offline'],
    // Panne du serveur (502, 503, 504) : pas « vérifiez votre connexion »
    [{ name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' }, 'auth_error_server_unavailable'],
    // Code de validation générique (mot de passe vide, format) : jamais « adresse e-mail invalide »
    [{ name: 'AuthApiError', status: 422, code: 'validation_failed', message: 'Unable to validate' }, 'auth_error_generic'],
    [{ name: 'AuthApiError', status: 400, code: 'validation_failed', message: 'Unable to validate email address: invalid format' }, 'auth_error_email_invalid'],
    [new TypeError('Failed to fetch'), 'auth_error_offline'],
    [{ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' }, 'auth_error_offline'],
    [{ name: 'AuthApiError', status: 429, message: 'Too many requests' }, 'auth_error_rate_limit'],
    [{ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' }, 'auth_error_invalid_credentials'],
    [{ name: 'AuthApiError', status: 500, message: 'Database error saving new user' }, 'auth_error_generic'],
    // Messages précis plutôt que le repli générique
    [{ name: 'AuthApiError', status: 400, code: 'reauthentication_needed', message: 'Password update requires reauthentication' }, 'auth_error_reauthentication'],
    [{ name: 'AuthApiError', status: 400, code: 'reauthentication_not_valid', message: 'Verification code invalid' }, 'auth_error_reauthentication'],
    [{ name: 'AuthApiError', status: 422, code: 'signup_disabled', message: 'Signups not allowed for this instance' }, 'auth_error_signup_disabled'],
    [{ name: 'AuthApiError', status: 400, code: 'captcha_failed', message: 'captcha protection: request disallowed' }, 'auth_error_captcha'],
    [{ name: 'AuthApiError', status: 504, code: 'request_timeout', message: 'Processing this request timed out' }, 'auth_error_server_unavailable'],
    // Session expirée pendant une modification (mot de passe, adresse, suppression)
    [{ name: 'AuthSessionMissingError', status: 400, message: 'Auth session missing!' }, 'auth_error_session_expired'],
    [{ name: 'AuthApiError', status: 403, code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' }, 'auth_error_session_expired'],
    [{ name: 'AuthApiError', status: 403, code: 'session_expired', message: 'Session expired' }, 'auth_error_session_expired'],
    [{ name: 'AuthApiError', status: 400, code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }, 'auth_error_session_expired'],
    ['quelque chose', 'auth_error_generic'],
    [null, 'auth_error_generic'],
  ])('%o → %s', (error, key) => {
    expect(authErrorKey(error)).toBe(key);
  });

  it('un code qui porte le nom d\'une propriété d\'objet ne sort pas de la table des codes', () => {
    expect(authErrorKey({ code: 'constructor' })).toBe('auth_error_generic');
    expect(authErrorKey({ code: 'toString', status: 429 })).toBe('auth_error_rate_limit');
  });
});

describe('isWrongPasswordError', () => {
  it('vrai seulement pour un refus du mot de passe', () => {
    expect(isWrongPasswordError({ code: 'invalid_credentials' })).toBe(true);
    expect(isWrongPasswordError({ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' })).toBe(false);
    expect(isWrongPasswordError({ status: 429, code: 'over_request_rate_limit' })).toBe(false);
  });
});
