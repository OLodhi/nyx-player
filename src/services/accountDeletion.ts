/**
 * Suppression du compte : nettoyage local garanti.
 *
 * La demande est notée sur l'appareil avant l'appel au serveur, avec l'identifiant du compte. Si
 * l'app est fermée avant la réponse, ou si la réponse se perd (réseau coupé), le lancement suivant
 * finit le nettoyage local : les données d'un compte supprimé ne restent pas sur l'appareil. Si le
 * serveur n'avait pas encore supprimé le compte, l'utilisateur est seulement déconnecté et peut se
 * reconnecter ou recommencer.
 *
 * Suppression confirmée par le serveur (`confirmAccountDeletion`) : l'identifiant du compte, noté
 * avec la marque, sert à viser sa base (`nyxplayer_<uid>.db`) et ses identifiants IPTV
 * (`iptv_credentials_<uid>`) au lancement, avant toute connexion : sans lui, ni l'une ni les autres
 * n'étaient effacés. La marque reste pendant le nettoyage (gardée par la remise à zéro) et n'est
 * retirée qu'une fois la base effacée : une app fermée au milieu du nettoyage le reprend au
 * lancement suivant, au plus `MAX_ATTEMPTS` fois, pour ne jamais boucler.
 * Réponse du serveur perdue : le compte existe peut-être encore, sa base et ses identifiants IPTV
 * sont gardés et seule la session part, comme avant.
 *
 * Un autre compte se connecte sur l'appareil avant le lancement suivant : la marque est retirée
 * (`forgetAccountDeletionOfOtherAccount`), sinon la reprise au lancement coupait aussi sa session.
 */

import { devLog } from '../utils/devLog';
import { createLogger } from '../utils/logger';

const log = createLogger('Account');

export const ACCOUNT_DELETION_PENDING_KEY = 'nyx_account_deletion_pending';

/**
 * Compte supprimé depuis un autre appareil (accountExistenceCheck.ts) : gardée par la remise à
 * zéro comme la marque, lue une seule fois par l'écran de connexion pour l'expliquer.
 */
export const ACCOUNT_DELETED_NOTICE_KEY = 'nyx_account_deleted_elsewhere';

/** Lancements qui reprennent un nettoyage avant d'y renoncer */
const MAX_ATTEMPTS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PendingDeletion {
  /** Compte supprimé ; null si inconnu (ancienne marque « 1 ») */
  uid: string | null;
  /** Reprises déjà lancées au démarrage */
  attempts: number;
  /** Suppression confirmée par le serveur : la base et les identifiants du compte peuvent partir */
  confirmed: boolean;
}

function readPending(): PendingDeletion | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(ACCOUNT_DELETION_PENDING_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingDeletion> | number;
    if (parsed && typeof parsed === 'object') {
      return {
        uid: typeof parsed.uid === 'string' && UUID.test(parsed.uid) ? parsed.uid : null,
        attempts: typeof parsed.attempts === 'number' && parsed.attempts >= 0 ? parsed.attempts : 0,
        confirmed: parsed.confirmed === true,
      };
    }
  } catch {
    // Marque illisible : traitée comme une marque sans compte
  }
  return { uid: null, attempts: 0, confirmed: false };
}

function writePending(pending: PendingDeletion): void {
  try {
    localStorage.setItem(ACCOUNT_DELETION_PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Stockage indisponible : la suppression continue, seule la reprise au lancement manquera
  }
}

/** À appeler juste avant la demande de suppression au serveur, avec le compte à supprimer */
export function markAccountDeletionPending(uid: string | null | undefined): void {
  writePending({ uid: uid && UUID.test(uid) ? uid : null, attempts: 0, confirmed: false });
}

/** Le serveur a supprimé le compte : le nettoyage peut viser sa base et ses identifiants IPTV */
export function confirmAccountDeletion(): void {
  const pending = readPending();
  if (pending) writePending({ ...pending, confirmed: true });
}

/** Suppression refusée par le serveur, ou nettoyage local terminé : rien à finir au prochain lancement */
export function clearAccountDeletionPending(): void {
  try {
    localStorage.removeItem(ACCOUNT_DELETION_PENDING_KEY);
  } catch {
    // Stockage indisponible : rien à retirer
  }
}

/**
 * Un compte ouvre sa session : une suppression en attente pour un AUTRE compte n'est plus reprise
 * au lancement, la remise à zéro couperait la session du compte connecté. Le
 * compte supprimé n'a déjà plus de session sur l'appareil. Même compte : la marque reste. Compte de
 * la marque inconnu (ancienne marque « 1 ») : traité comme un autre compte, la session ouverte est
 * protégée. Cas extrême (remise à zéro échouée hors de ses étapes protégées, puis connexion d'un
 * autre compte) : la base et les identifiants IPTV du compte supprimé restent sur l'appareil.
 */
export function forgetAccountDeletionOfOtherAccount(uid: string): void {
  const pending = readPending();
  if (!pending || pending.uid === uid) return;
  devLog('session', "Un autre compte s'est connecté : la suppression interrompue n'est plus reprise");
  clearAccountDeletionPending();
}

export function isAccountDeletionPending(): boolean {
  return readPending() !== null;
}

/**
 * Au lancement : finit le nettoyage local d'une suppression interrompue (remise à zéro complète,
 * session du compte comprise, puis relance de l'app). Retourne true si un nettoyage a été lancé.
 */
export async function finishPendingAccountDeletion(
  reset: (uid: string | null) => Promise<void> = defaultReset,
): Promise<boolean> {
  const pending = readPending();
  if (!pending) return false;
  if (pending.attempts >= MAX_ATTEMPTS) {
    log.warn(`Nettoyage d'un compte supprimé abandonné après ${MAX_ATTEMPTS} essais`);
    clearAccountDeletionPending();
    return false;
  }
  log.warn('Suppression du compte interrompue : fin du nettoyage local');
  const target = pending.confirmed ? pending.uid : null;
  if (target) {
    // Essai compté avant de commencer : une app fermée pendant le nettoyage ne boucle pas
    writePending({ ...pending, attempts: pending.attempts + 1 });
  } else {
    // Suppression non confirmée (le compte existe peut-être encore) ou compte inconnu : seule la
    // session part, sans viser sa base ni ses identifiants, en un seul essai (comme avant)
    clearAccountDeletionPending();
  }
  await reset(target);
  return true;
}

async function defaultReset(uid: string | null): Promise<void> {
  if (uid) {
    // Base et identifiants IPTV du compte supprimé, visés comme pendant une session (importés à
    // la demande : ce fichier est chargé au démarrage de chaque lancement)
    const [{ setDatabaseName }, { setKeyringUser }] = await Promise.all([import('./dbCore'), import('./storage')]);
    setDatabaseName(uid);
    setKeyringUser(uid);
  }
  const { performFullReset } = await import('./fullResetService');
  await performFullReset({ deleteAccount: true });
}
