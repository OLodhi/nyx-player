/**
 * playbackActivity.ts — Une vidéo est-elle en cours (ou en train de démarrer) ?
 *
 * Module sans React, lu par les travaux de fond qui doivent laisser toute la place au lecteur
 * (actualisation du catalogue toutes les 12 h, installation d'un catalogue neuf). Alimenté par
 * PlayerContext : lecture en cours ou fondu de démarrage/arrêt (`isTransitioningToPlayer`).
 */

import { createLogger } from '../utils/logger';

const log = createLogger('PlaybackActivity');

type Listener = (busy: boolean) => void;

let playbackBusy = false;
const listeners = new Set<Listener>();

/** Vrai pendant une lecture et pendant son démarrage ou son arrêt */
export function isPlaybackBusy(): boolean {
  return playbackBusy;
}

/** Appelé par PlayerContext à chaque changement ; prévient les abonnés seulement si l'état change */
export function setPlaybackBusy(busy: boolean): void {
  if (busy === playbackBusy) return;
  playbackBusy = busy;
  for (const listener of [...listeners]) {
    try {
      listener(busy);
    } catch (e) {
      log.warn('listener failed:', e);
    }
  }
}

/** Abonnement ; renvoie la fonction de désabonnement */
export function onPlaybackBusyChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
