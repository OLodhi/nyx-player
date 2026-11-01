/**
 * EPG Helpers — Utilitaires partagés pour les fonctionnalités EPG.
 *
 * Fonctions pures extraites pour réutilisation entre :
 * - useGridEpg (grille de chaînes — "now playing")
 * - useGuideTvData (guide TV — timeline complète)
 */

import type { IptvStream } from '../types/iptv';

/**
 * Collecte les epg_channel_id uniques non-null à partir des chaînes.
 * Priorise `matched_epg_id` (mapping Rust) sur `epg_channel_id` (brut IPTV).
 *
 * @param channels — Liste des chaînes IptvStream
 * @returns Tableau d'IDs EPG uniques
 */
export function collectEpgIds(channels: IptvStream[]): string[] {
  const set = new Set<string>();
  for (const ch of channels) {
    const id = ch.matched_epg_id || ch.epg_channel_id;
    if (id) set.add(id);
  }
  return Array.from(set);
}

/**
 * Retourne le timestamp epoch (secondes) du minuit UTC du jour contenant `epochSeconds`.
 *
 * @param epochSeconds — Timestamp epoch en secondes
 * @returns Epoch seconds du minuit UTC correspondant
 */
export function getDayMidnight(epochSeconds: number): number {
  return Math.floor(epochSeconds / 86400) * 86400;
}
