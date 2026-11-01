/**
 * Contrôles de l'écran Compte sortis d'AccountSection : ordre des messages d'erreur
 * et vérification du mot de passe actuel par reconnexion.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { signInWithPassword, getSession, adminSignOut } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  adminSignOut: vi.fn(),
}));
vi.mock('../../../../services/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword, getSession, admin: { signOut: adminSignOut } } },
}));

import { passwordChangeError, emailChangeError, isCurrentPasswordValid, authErrorMessageKey } from '../accountChecks';

describe('passwordChangeError', () => {
  it('mot de passe actuel manquant en premier, même si le reste est faux', () => {
    expect(passwordChangeError('', 'x', 'y')).toBe('account_current_password_required');
  });
  it('puis la longueur minimale (10 caractères)', () => {
    expect(passwordChangeError('a', '123456789', '123456789')).toBe('account_password_min_length');
    expect(passwordChangeError('a', '1234567890', '1234567890')).toBeNull();
  });
  it('puis la confirmation', () => {
    expect(passwordChangeError('a', '1234567890', '1234567899')).toBe('account_passwords_no_match');
  });
});

describe('emailChangeError', () => {
  it('mot de passe manquant en premier', () => {
    expect(emailChangeError('', '')).toBe('account_current_password_required');
  });
  it('adresse vide, faite d\'espaces ou sans arobase', () => {
    expect(emailChangeError('p', '')).toBe('account_email_invalid');
    expect(emailChangeError('p', '   ')).toBe('account_email_invalid');
    expect(emailChangeError('p', 'nom.domaine')).toBe('account_email_invalid');
  });
  it('adresse acceptée telle quelle (le serveur fait le contrôle complet)', () => {
    expect(emailChangeError('p', 'a@b')).toBeNull();
  });
});

describe('isCurrentPasswordValid', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'ancien-jeton' } }, error: null });
    adminSignOut.mockReset().mockResolvedValue({ data: null, error: null });
  });

  it('se reconnecte avec l\'adresse du compte', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(isCurrentPasswordValid('moi@test.invalid', 'secret')).resolves.toBe(true);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'moi@test.invalid', password: 'secret' });
  });
  it('adresse inconnue : chaîne vide, comme avant', async () => {
    signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } });
    await expect(isCurrentPasswordValid(undefined, 'secret')).resolves.toBe(false);
    expect(signInWithPassword).toHaveBeenCalledWith({ email: '', password: 'secret' });
  });
  it('une erreur réseau remonte à l\'appelant', async () => {
    signInWithPassword.mockRejectedValue(new Error('réseau'));
    await expect(isCurrentPasswordValid('a@b', 'x')).rejects.toThrow('réseau');
  });
  // Formes réelles du SDK : il ne lève pas, il rend l'erreur (hors ligne, trop d'essais)
  it('hors ligne : pas « mot de passe incorrect », l\'erreur remonte avec sa vraie raison', async () => {
    const offline = { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' };
    signInWithPassword.mockResolvedValue({ error: offline });
    await expect(isCurrentPasswordValid('a@b', 'x')).rejects.toBe(offline);
    expect(authErrorMessageKey(offline)).toBe('auth_error_offline');
  });
  it('trop d\'essais (429) : pas « mot de passe incorrect »', async () => {
    const limited = { name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'Request rate limit reached' };
    signInWithPassword.mockResolvedValue({ error: limited });
    await expect(isCurrentPasswordValid('a@b', 'x')).rejects.toBe(limited);
    expect(authErrorMessageKey(limited)).toBe('auth_error_rate_limit');
  });

  // La reconnexion ouvre une session neuve (gardée, le serveur exige une
  // connexion récente pour supprimer le compte) ; l'ancienne de cet appareil ne restait plus orpheline.
  it('bon mot de passe : ferme l\'ancienne session de cet appareil seulement', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(isCurrentPasswordValid('moi@test.invalid', 'secret')).resolves.toBe(true);
    expect(adminSignOut).toHaveBeenCalledTimes(1);
    expect(adminSignOut).toHaveBeenCalledWith('ancien-jeton', 'local');
    expect(getSession.mock.invocationCallOrder[0]).toBeLessThan(signInWithPassword.mock.invocationCallOrder[0]);
  });
  it('mauvais mot de passe : aucune session fermée', async () => {
    signInWithPassword.mockResolvedValue({ error: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } });
    await expect(isCurrentPasswordValid('moi@test.invalid', 'faux')).resolves.toBe(false);
    expect(adminSignOut).not.toHaveBeenCalled();
  });
  it('fermeture refusée ou réseau coupé : la vérification reste réussie', async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    adminSignOut.mockResolvedValueOnce({ data: null, error: { name: 'AuthApiError', status: 401 } });
    await expect(isCurrentPasswordValid('a@b', 'x')).resolves.toBe(true);
    adminSignOut.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(isCurrentPasswordValid('a@b', 'x')).resolves.toBe(true);
  });
  it('aucune session avant : rien à fermer', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    signInWithPassword.mockResolvedValue({ error: null });
    await expect(isCurrentPasswordValid('a@b', 'x')).resolves.toBe(true);
    expect(adminSignOut).not.toHaveBeenCalled();
  });
});
