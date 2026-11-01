/**
 * useStallWatchdog — Coupure réseau pendant la lecture.
 *
 * Jusqu'ici seul l'échec d'ouverture d'un flux était détecté : si la connexion tombait en cours
 * de lecture, le lecteur restait en mise en mémoire tampon sans fin. Après un temps d'attente,
 * on remonte une erreur réseau, qui déclenche l'écran d'erreur et la reconnexion espacée.
 *
 * useLiveEndWatchdog couvre l'autre forme de coupure : le fournisseur ferme proprement un direct.
 * Avec `keep-open=yes`, mpv ne signale alors aucune erreur, il atteint la « fin du fichier » et
 * se met en pause sur la dernière image (qui ressemble à une pause voulue). Il se reconnecte alors
 * une fois tout seul avant d'afficher l'écran d'erreur.
 */

import { useEffect, useRef } from 'react';
import { emitPlaybackError } from '../services/player/playbackErrors';
import { createLogger } from '../utils/logger';

const log = createLogger('LiveEndWatchdog');

/** Mise en tampon plus longue que ça = le flux ne revient pas tout seul */
export const STALL_TIMEOUT_MS = 25_000;

export function useStallWatchdog(isBuffering: boolean, isPaused: boolean, isConnected: boolean): void {
  const reportedRef = useRef(false);

  useEffect(() => {
    if (!isConnected || !isBuffering || isPaused) {
      reportedRef.current = false;
      return;
    }
    if (reportedRef.current) return;

    const timer = setTimeout(() => {
      reportedRef.current = true;
      emitPlaybackError({ kind: 'network', engine: 'mpv' });
    }, STALL_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [isBuffering, isPaused, isConnected]);
}

/** Fin de fichier qui dure : pas un simple rechargement de liste de lecture (HLS en direct) */
export const LIVE_END_CONFIRM_MS = 3_000;

/**
 * Après la reconnexion immédiate, temps laissé au flux pour repartir avant d'afficher l'écran
 * d'erreur (si la relance n'a pas pu partir, la fin reste atteinte).
 */
export const LIVE_RECONNECT_GRACE_MS = 10_000;

/**
 * Un direct n'a pas de fin : s'il l'atteint, c'est que le fournisseur a coupé le flux.
 *
 * Première coupure (aucune relance en cours, `retryAttempt` à 0) : le lecteur se reconnecte tout
 * seul, tout de suite, sans écran d'erreur. Cette relance compte comme une tentative :
 * si le direct recoupe avant d'être reparti pour de bon (usePlaybackRecovery remet alors le compteur
 * à zéro), c'est l'écran d'erreur et sa reconnexion espacée, qui ménage l'anti-flood du fournisseur.
 * Les films et épisodes ne sont pas concernés (leur fin est gérée par le Binge Mode).
 */
export function useLiveEndWatchdog(
  eofReached: boolean,
  isLive: boolean,
  isConnected: boolean,
  retryAttempt = 0,
  reconnect?: () => void | Promise<void>,
): void {
  const reconnectRef = useRef(reconnect);
  const attemptRef = useRef(retryAttempt);
  useEffect(() => {
    reconnectRef.current = reconnect;
    attemptRef.current = retryAttempt;
  });

  useEffect(() => {
    if (!isConnected || !isLive || !eofReached) return;

    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => {
      const quickReconnect = reconnectRef.current;
      if (!quickReconnect || attemptRef.current > 0) {
        emitPlaybackError({ kind: 'network', engine: 'mpv' });
        return;
      }
      // Le nouveau flux remet la fin à « non atteinte » et annule ce minuteur ; s'il ne part pas, erreur
      graceTimer = setTimeout(() => {
        emitPlaybackError({ kind: 'network', engine: 'mpv' });
      }, LIVE_RECONNECT_GRACE_MS);
      void Promise.resolve()
        .then(() => quickReconnect())
        .catch((e) => log.warn('Reconnection failed:', e));
    }, LIVE_END_CONFIRM_MS);

    return () => {
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
    };
  }, [eofReached, isLive, isConnected]);
}
