/**
 * memoryService.ts — Service centralisé de purge mémoire WebView2
 *
 * Expose deux fonctions pour demander une purge mémoire au renderer Chromium :
 * - `requestMemoryPurge()` : debounced (1s) — à appeler sur les events fréquents (scroll)
 * - `forceMemoryPurge()` : immédiat — à appeler sur les events ponctuels (changement de page)
 *
 * Côté Rust, la commande `trim_memory` fait le cycle :
 *   SetMemoryUsageTargetLevel(Low) → 3s → SetMemoryUsageTargetLevel(Normal)
 * Ce cycle force PartitionAlloc à decommit les empty spans et Blink à purger
 * son decoded image cache.
 *
 * @see src-tauri/src/lib.rs (trim_memory command, L454)
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { devLog } from '../utils/devLog';
import { isAndroid, isMobileDevice } from '../utils/platform';

/** Budgets mémoire WebView2 : sans objet sur Android (téléphone comme TV) et iOS, les commandes Rust ne
 *  font quelque chose que sous Windows. Sur TV, l'aller-retour inutile partait 1 s après chaque arrêt du
 *  défilement de l'accueil. */
const invoke = (command: string): Promise<unknown> =>
  isAndroid() || isMobileDevice() ? Promise.resolve() : tauriInvoke(command);

// =============================================================================
// ÉTAT INTERNE
// =============================================================================

/** Verrou : empêche 2 purges de s'exécuter en parallèle */
let isPurging = false;

/** Verrou : bloque les purges classiques (trim_memory) quand le player est actif.
 *  trim_memory fait Low→3s→Normal, ce qui casserait le mode Low permanent du player.
 *  Seule purgeInPlayerMode() (Normal→200ms→Low) est autorisée en mode player. */
let inPlayerMode = false;

/** ID du timer debounce pour `requestMemoryPurge()` */
let debounceTimerId: ReturnType<typeof setTimeout> | null = null;

/** Délai debounce en millisecondes */
const DEBOUNCE_DELAY_MS = 1_000;

// =============================================================================
// FONCTIONS INTERNES
// =============================================================================

/**
 * Exécute un cycle de purge mémoire via la commande Rust `trim_memory`.
 * Protégé par un verrou : si une purge est déjà en cours, l'appel est ignoré.
 *
 * @param source — identifiant de l'appelant (pour les logs)
 */
async function executePurge(source: string): Promise<void> {
  if (inPlayerMode) {
    devLog('memory', `🛡 Purge bloquée (player actif) — source: ${source}`);
    return;
  }

  if (isPurging) {
    devLog('memory', `⏭ Purge ignorée (déjà en cours) — source: ${source}`);
    return;
  }

  isPurging = true;
  devLog('memory', `🧹 Purge déclenchée — source: ${source}`);

  try {
    await invoke('trim_memory');
    devLog('memory', `✅ Purge terminée — source: ${source}`);
  } catch (error) {
    devLog('memory', `❌ Erreur purge: ${error}`);
  } finally {
    isPurging = false;
  }
}

// =============================================================================
// API PUBLIQUE
// =============================================================================

/**
 * Demande une purge mémoire avec debounce de 1s.
 *
 * Chaque appel réinitialise le timer. La purge ne se déclenche que 1s
 * après le DERNIER appel — idéal pour les events fréquents comme le scroll.
 *
 * Usage : `container.addEventListener('scroll', requestMemoryPurge)`
 */
export function requestMemoryPurge(): void {
  if (debounceTimerId !== null) {
    clearTimeout(debounceTimerId);
  }

  debounceTimerId = setTimeout(() => {
    debounceTimerId = null;
    void executePurge('scroll-debounce');
  }, DEBOUNCE_DELAY_MS);
}

/**
 * Force une purge mémoire immédiate (sans debounce).
 *
 * À utiliser pour les events ponctuels comme les changements de page/tab.
 * Si un debounce de scroll était en attente, il est annulé.
 */
export function forceMemoryPurge(): void {
  // Annuler tout debounce scroll en attente
  if (debounceTimerId !== null) {
    clearTimeout(debounceTimerId);
    debounceTimerId = null;
  }

  void executePurge('page-change');
}

// =============================================================================
// MODE PLAYER — Low Memory permanent
// =============================================================================

/**
 * Active le mode Low Memory permanent pour la durée de la lecture.
 *
 * `set_memory_low` maintient des budgets mémoire réduits en continu.
 * Combiné avec `visibility: hidden` sur le DOM (via CSS `.main-ui.is-hidden`),
 * Chromium n'a aucune raison de ré-allouer — la RAM reste basse.
 */
export async function enterPlayerMode(): Promise<void> {
  inPlayerMode = true;
  devLog('memory', '🎬 Player mode ON → set_memory_low (purges classiques bloquées)');

  // Annuler tout debounce/purge en attente pour éviter qu'un trim_memory
  // lancé juste avant ne revienne 3s plus tard remettre en Normal
  if (debounceTimerId !== null) {
    clearTimeout(debounceTimerId);
    debounceTimerId = null;
  }

  try {
    await invoke('set_memory_low');
  } catch (error) {
    devLog('memory', `❌ Erreur enterPlayerMode: ${error}`);
  }
}

/**
 * Désactive le mode Low Memory et force une purge de nettoyage.
 *
 * Le retour à Normal permet à Chromium de re-render correctement l'UI.
 * La purge supplémentaire libère les éventuels restes du player.
 */
export async function exitPlayerMode(): Promise<void> {
  inPlayerMode = false;
  devLog('memory', '🎬 Player mode OFF → set_memory_normal (purges classiques réactivées)');
  try {
    await invoke('set_memory_normal');
  } catch (error) {
    devLog('memory', `❌ Erreur exitPlayerMode: ${error}`);
  }
  // Purge de nettoyage après retour à Normal
  forceMemoryPurge();
}

/**
 * Purge mémoire spéciale utilisée pendant la lecture active.
 *
 * Problème : le player est en mode `set_memory_low` permanent.
 * `forceMemoryPurge()` (→ trim_memory) ferait Low → 3s → Normal,
 * ce qui casserait le mode Low permanent.
 *
 * Solution : commande Rust dédiée `trim_memory_in_player` qui fait
 * Normal (200ms) → Low — force Chromium à re-évaluer ses allocations
 * sans jamais quitter le mode Low.
 *
 * Usage : appelé au changement de chaîne (switchChannel) pour éviter
 * l'accumulation RAM lors du zapping TV.
 */
export async function purgeInPlayerMode(): Promise<void> {
  devLog('memory', '📺 In-player purge → trim_memory_in_player');
  try {
    await invoke('trim_memory_in_player');
  } catch (error) {
    devLog('memory', `❌ Erreur purgeInPlayerMode: ${error}`);
  }
}
