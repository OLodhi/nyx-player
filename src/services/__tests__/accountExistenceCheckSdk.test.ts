/**
 * Tests : la seule hypothèse sur Supabase du correctif « compte supprimé ailleurs », vérifiée sur la vraie bibliothèque à
 * chaque mise à jour. Pour un utilisateur supprimé, le serveur répond 403 « user_not_found » ;
 * `getUser()` doit renvoyer ce code (sans effacer la session : c'est à l'app de nettoyer).
 */

import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isDeletedAccountError } from '../accountExistenceCheck';

function clientAnswering(status: number, body: Record<string, unknown>, apiVersion: boolean) {
  const fetchMock = async () => new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(apiVersion ? { 'x-supabase-api-version': '2024-01-01' } : {}),
    },
  });
  return createClient('https://projet-test.supabase.co', 'cle-anonyme-test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchMock },
  });
}

describe('Supabase getUser : utilisateur supprimé', () => {
  it('serveur récent (code dans « code ») : reconnu comme compte supprimé', async () => {
    const client = clientAnswering(403, { code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, true);
    const { error } = await client.auth.getUser('jeton-test');
    expect(isDeletedAccountError(error)).toBe(true);
  });

  it('serveur sans version d\'API (code dans « error_code ») : reconnu aussi', async () => {
    const client = clientAnswering(403, { error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' }, false);
    const { error } = await client.auth.getUser('jeton-test');
    expect(isDeletedAccountError(error)).toBe(true);
  });

  it('session introuvable, jeton invalide, panne : jamais pris pour un compte supprimé', async () => {
    for (const [status, body] of [
      [403, { code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }],
      [403, { code: 'bad_jwt', msg: 'invalid JWT' }],
      [500, { code: 'unexpected_failure', msg: 'boom' }],
    ] as const) {
      const { error } = await clientAnswering(status, body, true).auth.getUser('jeton-test');
      expect(error).not.toBeNull();
      expect(isDeletedAccountError(error)).toBe(false);
    }
  });
});
