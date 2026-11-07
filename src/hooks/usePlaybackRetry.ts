/**
 * usePlaybackRetry.ts — Compte à rebours de la reconnexion automatique espacée.
 *
 * Le compteur de tentatives vit dans PlayerContext (`retryAttempt`) et non ici : l'écran
 * d'erreur est démonté pendant chaque relance, un état local repartirait à zéro et
 * relancerait toutes les 15 s sans fin. PlayerContext applique aussi l'intervalle minimal
 * entre deux relances (bouton « Réessayer maintenant »).
 *
 * - Seules les erreurs passagères sont relancées (limite de connexions, réseau, serveur).
 * - Délais croissants RETRY_DELAYS_S (30, 60, 120, 180 s), 4 tentatives maximum : le
 *   fournisseur ne voit jamais de rafale de requêtes (anti-flood des panels Xtream).
 * - Android et iOS : le compte à rebours s'arrête tant que l'app est en arrière-plan (touche Accueil,
 *   appel), sinon la relance rouvrirait le flux sans personne devant l'écran. Il reprend au
 *   retour. Windows garde son comportement : une fenêtre réduite continue de se reconnecter.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RETRY_DELAYS_S, isAutoRetryable, type PlaybackError } from '../services/player/playbackErrors';
import { usesNyxPlugin } from '../utils/platform';

export interface PlaybackRetryState {
  /** Secondes avant la prochaine tentative automatique (null = aucune programmée) */
  secondsLeft: number | null;
  /** Tentatives déjà effectuées pour cette lecture */
  attempt: number;
  maxAttempts: number;
  /** Toutes les tentatives automatiques ont échoué */
  exhausted: boolean;
  /** L'utilisateur a arrêté la reconnexion automatique */
  cancelled: boolean;
  retryNow: () => void;
  cancel: () => void;
}

export function usePlaybackRetry(
  error: PlaybackError | null,
  attempt: number,
  retry: () => void | Promise<void>,
): PlaybackRetryState {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [cancelled, setCancelled] = useState(false);

  // retry peut changer d'identité à chaque rendu du contexte : ne pas relancer le compte à rebours pour autant
  const retryRef = useRef(retry);
  // eslint-disable-next-line react-hooks/refs -- dernière fonction de relance, appelée seulement par le minuteur (le compte à rebours n'est pas relancé)
  retryRef.current = retry;

  const maxAttempts = RETRY_DELAYS_S.length;
  const autoRetryable = !!error && isAutoRetryable(error.kind);

  useEffect(() => {
    if (!error || !autoRetryable || cancelled || attempt >= maxAttempts) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- compte à rebours (minuteur) : effacé quand aucune nouvelle tentative n'est programmée
      setSecondsLeft(null);
      return;
    }
    let left = RETRY_DELAYS_S[attempt];
    setSecondsLeft(left);
    const holdWhileHidden = usesNyxPlugin();
    const interval = setInterval(() => {
      if (holdWhileHidden && document.hidden) return;
      left -= 1;
      if (left > 0) {
        setSecondsLeft(left);
        return;
      }
      clearInterval(interval);
      setSecondsLeft(null);
      void retryRef.current();
    }, 1000);
    return () => clearInterval(interval);
  }, [error, autoRetryable, cancelled, attempt, maxAttempts]);

  const retryNow = useCallback(() => {
    setSecondsLeft(null);
    void retryRef.current();
  }, []);

  const cancel = useCallback(() => {
    setCancelled(true);
    setSecondsLeft(null);
  }, []);

  return {
    secondsLeft,
    attempt,
    maxAttempts,
    exhausted: autoRetryable && attempt >= maxAttempts,
    cancelled,
    retryNow,
    cancel,
  };
}
