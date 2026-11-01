/**
 * Ma liste lue une seule fois pour toutes les cartes d'un écran (accueil TV, rail/railRow.ts) : un ensemble de clés en
 * mémoire, lu de façon synchrone. Sans lui, chaque carte demandait à sa création si son titre était dans Ma liste, s'abonnait
 * aux changements et se redessinait avec la réponse : une question, une écoute et un second rendu par carte, à chaque
 * rangée montée.
 *
 * L'ensemble est relu à chaque changement de Ma liste (ajout, retrait, synchro) et oublié quand plus aucun écran ne
 * l'utilise (changement de profil ou de compte : l'écran suivant relit la base).
 */
import { onWatchlistChange, watchlistKeys } from '../services/watchlistHydration';
import { warnOnReject } from '../utils/warnOnReject';

let keys: Set<string> | null = null;
let generation = 0;
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

function load(): void {
  const asked = ++generation;
  watchlistKeys()
    .then((set) => {
      // Une lecture plus récente (changement arrivé entre-temps) ou plus personne à l'écoute : réponse ignorée
      if (asked !== generation || listeners.size === 0) return;
      keys = set;
      listeners.forEach((listener) => listener());
    })
    .catch(warnOnReject('Ma liste'));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopWatching) {
    stopWatching = onWatchlistChange(load);
    load();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
      keys = null;
      generation++;
    }
  };
}

/** Clés de Ma liste (`watchlistItemKey`) déjà lues, ou null tant qu'elles ne le sont pas. */
export function currentWatchlistKeys(): Set<string> | null {
  return keys;
}

/** Abonnement aux nouvelles clés (cartes et calque de sélection du rail) ; renvoie le désabonnement. */
export function onWatchlistKeys(listener: () => void): () => void {
  return subscribe(listener);
}
