/**
 * syncPurge : « Supprimer aussi mes données cloud » (5 tables) et cas d'erreur de l'effacement
 * propre au fournisseur.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Response = { error: { message: string } | null };
const h = vi.hoisted(() => ({
  userId: null as string | null,
  deletes: [] as { table: string; eq: [string, unknown][] }[],
  respond: null as unknown as (table: string) => Response | Promise<Response>,
  setMeta: vi.fn(async () => {}),
  getMeta: vi.fn(async (): Promise<string | null> => null),
  isSameAccount: vi.fn(() => true),
  clearBaselines: vi.fn(async () => {}),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => {
        const call = { table, eq: [] as [string, unknown][] };
        h.deletes.push(call);
        const builder = {
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return builder; },
          or: () => builder,
          then: (resolve: (v: Response) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve().then(() => h.respond(table)).then(resolve, reject),
        };
        return builder;
      },
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  },
}));
vi.mock('../syncState', () => ({ getCurrentSyncUserId: () => h.userId }));
vi.mock('../../dbCore', () => ({ getMeta: h.getMeta, setMeta: h.setMeta }));
vi.mock('../syncBaseline', () => ({ isSameAccount: h.isSameAccount, clearBaselines: h.clearBaselines }));
vi.mock('../../../utils/devLog', () => ({ devLog: vi.fn() }));

import {
  purgeCloudData, CLOUD_PURGE_TABLES, PROVIDER_SCOPED_TABLES,
  purgeProviderCloudData, settlePendingProviderPurge,
} from '../syncPurge';

beforeEach(() => {
  vi.clearAllMocks();
  h.userId = 'compte-a';
  h.deletes = [];
  h.respond = () => ({ error: null });
  h.isSameAccount.mockReturnValue(true);
  h.getMeta.mockResolvedValue(null);
});

describe('purgeCloudData', () => {
  it('efface les 5 tables pour le compte connecté seulement et renvoie une liste vide', async () => {
    expect(CLOUD_PURGE_TABLES).toHaveLength(5);
    await expect(purgeCloudData()).resolves.toEqual([]);
    expect(h.deletes.map((d) => d.table)).toEqual([...CLOUD_PURGE_TABLES]);
    for (const d of h.deletes) expect(d.eq).toEqual([['user_id', 'compte-a']]);
  });

  it('sans session de synchro : rien n\'est envoyé et toutes les tables sont déclarées en échec', async () => {
    h.userId = null;
    await expect(purgeCloudData()).resolves.toEqual([...CLOUD_PURGE_TABLES]);
    expect(h.deletes).toEqual([]);
  });

  it('liste les tables refusées par le serveur et continue avec les suivantes', async () => {
    h.respond = (table) => (table === 'user_watchlist' ? { error: { message: 'refusé' } } : { error: null });
    await expect(purgeCloudData()).resolves.toEqual(['user_watchlist']);
    expect(h.deletes).toHaveLength(5);
  });

  it('liste aussi les tables dont la requête lève une exception (hors ligne)', async () => {
    h.respond = (table) => {
      if (table === 'user_preferences' || table === 'user_hidden_categories') throw new Error('réseau coupé');
      return { error: null };
    };
    await expect(purgeCloudData()).resolves.toEqual(['user_preferences', 'user_hidden_categories']);
    expect(h.deletes).toHaveLength(5);
  });
});

describe('purgeProviderCloudData - exception réseau', () => {
  it('une exception compte comme un échec : la marque reste et les accords ne sont pas oubliés', async () => {
    h.respond = () => { throw new Error('hors ligne'); };
    await expect(purgeProviderCloudData('compte-a')).resolves.toBe(false);
    expect(h.deletes.map((d) => d.table)).toEqual([...PROVIDER_SCOPED_TABLES]);
    expect(h.setMeta).toHaveBeenCalledTimes(1);
    expect(h.setMeta).toHaveBeenCalledWith('provider_purge_pending', '1');
    expect(h.clearBaselines).not.toHaveBeenCalled();
  });

  it('compte changé pendant l\'effacement : la marque n\'est pas oubliée dans la base du nouveau compte', async () => {
    h.isSameAccount.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(purgeProviderCloudData('compte-a')).resolves.toBe(true);
    expect(h.clearBaselines).not.toHaveBeenCalled();
    expect(h.setMeta).not.toHaveBeenCalledWith('provider_purge_pending', '0');
  });
});

describe('settlePendingProviderPurge - erreur de lecture', () => {
  it('renvoie false (données du fournisseur non synchronisées) si la base de métadonnées échoue', async () => {
    h.getMeta.mockRejectedValueOnce(new Error('base fermée'));
    await expect(settlePendingProviderPurge('compte-a')).resolves.toBe(false);
    expect(h.deletes).toEqual([]);
  });
});
