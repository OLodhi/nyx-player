/**
 * guideLive - Instant du prochain changement de programme « en direct » dans le Guide TV
 */

import type { EpgProgram } from '../../services/epgService';

/**
 * Prochain instant (en s) où le programme « en direct » d'une chaîne change : le plus proche début ou
 * fin de programme après `nowSec`, ou null s'il n'y en a plus dans le guide chargé.
 */
export function nextLiveChangeSec(programs: Map<string, EpgProgram[]>, nowSec: number): number | null {
  let next: number | null = null;
  for (const list of programs.values()) {
    for (const p of list) {
      if (p.startTs > nowSec && (next === null || p.startTs < next)) next = p.startTs;
      if (p.stopTs > nowSec && (next === null || p.stopTs < next)) next = p.stopTs;
    }
  }
  return next;
}
