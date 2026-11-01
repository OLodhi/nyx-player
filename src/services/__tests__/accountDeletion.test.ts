/**
 * Tests : suppression du compte interrompue, nettoyage local fini au lancement suivant.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setDatabaseName = vi.fn();
const setKeyringUser = vi.fn();
const performFullReset = vi.fn(async (_options?: unknown) => {});
vi.mock('../dbCore', () => ({ setDatabaseName: (uid: string) => setDatabaseName(uid) }));
vi.mock('../storage', () => ({ setKeyringUser: (uid: string) => setKeyringUser(uid) }));
vi.mock('../fullResetService', () => ({ performFullReset: (options?: unknown) => performFullReset(options) }));

import {
  confirmAccountDeletion,
  markAccountDeletionPending,
  clearAccountDeletionPending,
  isAccountDeletionPending,
  finishPendingAccountDeletion,
  forgetAccountDeletionOfOtherAccount,
} from '../accountDeletion';

const UID = '0b8f2a6e-7c1d-4e5f-9a3b-2c4d6e8f0a1b';
const OTHER_UID = '7d3e9b1c-2a4f-4c6e-8b0d-1f3a5c7e9b2d';

describe('accountDeletion', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('lancement normal : aucun nettoyage', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it("app fermée avant la réponse du serveur : le lancement suivant finit le nettoyage", async () => {
    markAccountDeletionPending(UID);
    // … l'app est fermée ici ; au lancement suivant :
    expect(isAccountDeletionPending()).toBe(true);
    const reset = vi.fn(async () => { localStorage.clear(); });
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(true);
    expect(reset).toHaveBeenCalledOnce();
    // La remise à zéro vide le stockage local : pas de nouveau nettoyage au lancement d'après
    expect(isAccountDeletionPending()).toBe(false);
  });

  it('suppression refusée par le serveur : rien à finir au lancement', async () => {
    markAccountDeletionPending(UID);
    clearAccountDeletionPending();
    const reset = vi.fn().mockResolvedValue(undefined);
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('reprise au lancement : base et identifiants IPTV du compte supprimé visés', async () => {
    markAccountDeletionPending(UID);
    confirmAccountDeletion();
    await expect(finishPendingAccountDeletion()).resolves.toBe(true);
    // Avant toute connexion : sans le compte, ni sa base ni ses identifiants n'étaient effacés
    expect(setDatabaseName).toHaveBeenCalledWith(UID);
    expect(setKeyringUser).toHaveBeenCalledWith(UID);
    expect(performFullReset).toHaveBeenCalledWith({ deleteAccount: true });
    expect(setDatabaseName.mock.invocationCallOrder[0]).toBeLessThan(performFullReset.mock.invocationCallOrder[0]);
  });

  it('app fermée au milieu du nettoyage : repris au lancement suivant, sans boucle', async () => {
    markAccountDeletionPending(UID);
    confirmAccountDeletion();
    // Nettoyage interrompu à chaque fois (la marque reste)
    const reset = vi.fn(async () => {});
    for (let launch = 1; launch <= 3; launch++) {
      await expect(finishPendingAccountDeletion(reset)).resolves.toBe(true);
    }
    expect(reset).toHaveBeenCalledTimes(3);
    expect(reset).toHaveBeenCalledWith(UID);
    // Quatrième lancement : abandon, l'app démarre normalement
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(false);
    expect(reset).toHaveBeenCalledTimes(3);
    expect(isAccountDeletionPending()).toBe(false);
  });

  it("réponse du serveur perdue : le compte existe peut-être encore, ni sa base ni ses identifiants ne sont visés", async () => {
    markAccountDeletionPending(UID);
    await expect(finishPendingAccountDeletion()).resolves.toBe(true);
    expect(setDatabaseName).not.toHaveBeenCalled();
    expect(setKeyringUser).not.toHaveBeenCalled();
    expect(performFullReset).toHaveBeenCalledWith({ deleteAccount: true });
    // Un seul essai, comme avant
    expect(isAccountDeletionPending()).toBe(false);
  });

  it("ancienne marque sans compte : un seul essai", async () => {
    localStorage.setItem('nyx_account_deletion_pending', '1');
    const reset = vi.fn(async () => {});
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(true);
    expect(reset).toHaveBeenCalledWith(null);
    expect(isAccountDeletionPending()).toBe(false);
    expect(setDatabaseName).not.toHaveBeenCalled();
  });

  it('identifiant de compte invalide : non utilisé pour viser des fichiers', async () => {
    markAccountDeletionPending('../../autre');
    confirmAccountDeletion();
    const reset = vi.fn(async () => {});
    await finishPendingAccountDeletion(reset);
    expect(reset).toHaveBeenCalledWith(null);
  });

  it("un autre compte se connecte avant le lancement suivant : sa session n'est pas coupée", async () => {
    // Réponse du serveur perdue pour le compte X, puis le compte Y se connecte sur l'appareil
    markAccountDeletionPending(UID);
    forgetAccountDeletionOfOtherAccount(OTHER_UID);
    expect(isAccountDeletionPending()).toBe(false);
    // Lancement suivant : aucune remise à zéro, la session de Y reste
    const reset = vi.fn(async () => {});
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it('le même compte se reconnecte : sa suppression interrompue est toujours reprise', async () => {
    markAccountDeletionPending(UID);
    forgetAccountDeletionOfOtherAccount(UID);
    expect(isAccountDeletionPending()).toBe(true);
    const reset = vi.fn(async () => {});
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(true);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("connexion sans suppression en attente : rien n'est noté", () => {
    forgetAccountDeletionOfOtherAccount(OTHER_UID);
    expect(isAccountDeletionPending()).toBe(false);
  });

  it('marque sans compte connu : traitée comme celle d\'un autre compte, la session ouverte est protégée', () => {
    localStorage.setItem('nyx_account_deletion_pending', '1');
    forgetAccountDeletionOfOtherAccount(OTHER_UID);
    expect(isAccountDeletionPending()).toBe(false);
  });

  it('suppression confirmée : les événements du même compte gardent la marque et sa cible', async () => {
    markAccountDeletionPending(UID);
    confirmAccountDeletion();
    forgetAccountDeletionOfOtherAccount(UID);
    const reset = vi.fn(async () => {});
    await expect(finishPendingAccountDeletion(reset)).resolves.toBe(true);
    expect(reset).toHaveBeenCalledWith(UID);
  });
});
