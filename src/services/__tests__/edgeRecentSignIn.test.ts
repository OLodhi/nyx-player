import { describe, it, expect } from 'vitest';
import { signedInRecently } from '../../../supabase/functions/_shared/recentSignIn';

// Fonction serveur delete-account : seul un mot de passe tapé juste avant la demande
// permet de supprimer le compte. L'app se reconnecte avec le mot de passe juste avant l'appel.
describe('delete-account : connexion récente exigée', () => {
  const now = 1_800_000_000;

  it('accepte un mot de passe tapé il y a quelques secondes', () => {
    expect(signedInRecently({ amr: [{ method: 'password', timestamp: now - 5 }] }, now)).toBe(true);
  });

  it('refuse une session ouverte depuis plus de 10 minutes, même avec un jeton rafraîchi', () => {
    expect(signedInRecently({ amr: [{ method: 'password', timestamp: now - 11 * 60 }] }, now)).toBe(false);
  });

  it('refuse un jeton sans connexion par mot de passe ou sans date', () => {
    expect(signedInRecently({ amr: [{ method: 'otp', timestamp: now }] }, now)).toBe(false);
    expect(signedInRecently({ amr: [{ method: 'password' }] }, now)).toBe(false);
    expect(signedInRecently({}, now)).toBe(false);
    expect(signedInRecently({ amr: 'password' }, now)).toBe(false);
  });

  it('garde la connexion la plus récente quand le jeton en liste plusieurs', () => {
    const amr = [{ method: 'password', timestamp: now - 3600 }, { method: 'password', timestamp: now - 30 }];
    expect(signedInRecently({ amr }, now)).toBe(true);
  });
});
