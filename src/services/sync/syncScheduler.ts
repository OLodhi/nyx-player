/**
 * syncScheduler.ts — Synchro relancée pendant la session
 *
 * La synchro complète ne tournait qu'à l'ouverture de la session : un envoi raté (coupure réseau,
 * jeton expiré) attendait le démarrage suivant, et une TV allumée des jours ne voyait pas les
 * changements des autres appareils. Elle est désormais relancée :
 * - au retour du réseau ;
 * - au retour dans l'app (premier plan, ou fenêtre réactivée sous Windows), au plus une fois toutes
 *   les MIN_GAP_MS ;
 * - toutes les EVERY_MS ;
 * - tout de suite après « Rafraîchir » dans les Réglages (sans elle, un titre ajouté à Ma liste
 *   sur un autre appareil n'apparaissait pas, et le bouton repoussait même la relance suivante).
 * Jamais pendant une vidéo (reprise à la fin de la lecture), jamais deux à la fois, et jamais pour un
 * compte qui n'est plus celui de la base ouverte. Le dernier accord (syncBaseline.ts) fait que ces
 * synchros rattrapent aussi les retraits ratés.
 */

import { syncAll } from './syncService';
import { isSameAccount, bumpGeneration } from './syncBaseline';
import { isPlaybackBusy, onPlaybackBusyChange } from '../playbackActivity';
import { devLog } from '../../utils/devLog';
import { createLogger } from '../../utils/logger';

const log = createLogger('Sync');

/** Synchro régulière */
export const EVERY_MS = 15 * 60 * 1000;
/** Écart minimal entre deux synchros déclenchées par le retour dans l'app ou du réseau */
export const MIN_GAP_MS = 2 * 60 * 1000;
/** Petit délai après le retour du réseau, le temps que la connexion s'établisse */
export const ONLINE_DELAY_MS = 3000;

let userId: string | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let onlineTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribePlayback: (() => void) | null = null;
let running: Promise<void> | null = null;
let lastRunAt = 0;
/** Une synchro a été demandée pendant une vidéo : elle part à la fin de la lecture */
let pendingAfterPlayback = false;

async function run(reason: string): Promise<void> {
  const current = userId;
  if (!current || running) return;
  if (isPlaybackBusy()) {
    pendingAfterPlayback = true;
    return;
  }
  if (!isSameAccount(current)) return;
  lastRunAt = Date.now();
  running = (async () => {
    try {
      const result = await syncAll(current);
      devLog('sync', `Resync (${reason}) done`, result);
    } catch (err) {
      log.warn(`Resync (${reason}) failed:`, err);
    } finally {
      running = null;
    }
  })();
  await running;
}

function runIfNotRecent(reason: string): void {
  if (Date.now() - lastRunAt < MIN_GAP_MS) return;
  void run(reason);
}

function onOnline(): void {
  if (onlineTimer) clearTimeout(onlineTimer);
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    // Retour du réseau : l'écart minimal ne compte pas, c'est le moment de rattraper les envois ratés
    void run('retour du réseau');
  }, ONLINE_DELAY_MS);
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    runIfNotRecent("retour dans l'app");
  }
}

/**
 * Fenêtre réactivée. Sous Windows (WebView2), réduire puis réafficher la fenêtre ne change pas
 * toujours la visibilité de la page : le retour de l'activation de la fenêtre le rattrape. Les deux
 * arrivent souvent ensemble : l'écart minimal n'en garde qu'un.
 */
function onWindowFocus(): void {
  runIfNotRecent("retour dans l'app");
}

/**
 * Démarre les relances pour le compte dont la session vient de s'ouvrir (la synchro d'ouverture
 * vient d'avoir lieu : la première relance attend son tour). Avec `syncNow`, une synchro part tout
 * de suite (« Rafraîchir » : l'utilisateur attend aussi les changements des autres appareils).
 */
export function startCloudResync(forUserId: string, { syncNow = false }: { syncNow?: boolean } = {}): void {
  // Sans changer de génération : la synchro d'ouverture tourne encore (favoris TV, reprises, lancés
  // sans être attendus) et doit pouvoir écrire. Seuls un arrêt et un effacement l'invalident.
  teardown();
  userId = forUserId;
  lastRunAt = Date.now();
  interval = setInterval(() => void run('synchro régulière'), EVERY_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onWindowFocus);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  unsubscribePlayback = onPlaybackBusyChange((busy) => {
    if (!busy && pendingAfterPlayback) {
      pendingAfterPlayback = false;
      void run('fin de la lecture');
    }
  });
  devLog('sync', `Resync planned (every ${EVERY_MS / 60000} min, network back, app foreground)`);
  if (syncNow) void run('actualisation');
}

/** Arrête les relances (déconnexion, changement de compte, connexion, actualisation complète) */
export function stopCloudResync(): void {
  // Une synchro en cours n'écrit plus rien (un effacement suit souvent : connexion, remise à zéro)
  bumpGeneration();
  teardown();
}

/** Retire les relances planifiées, sans toucher aux synchros en cours */
function teardown(): void {
  if (interval) clearInterval(interval);
  if (onlineTimer) clearTimeout(onlineTimer);
  interval = onlineTimer = null;
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('focus', onWindowFocus);
  }
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  unsubscribePlayback?.();
  unsubscribePlayback = null;
  pendingAfterPlayback = false;
  userId = null;
}

/** Synchro en cours (tests, et attente avant une écriture complète) */
export function waitForCloudResync(): Promise<void> {
  return running ?? Promise.resolve();
}
