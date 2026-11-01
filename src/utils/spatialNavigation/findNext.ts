/**
 * Règles de parcours : choix de l'élément suivant selon les zones, les étages et les pièges
 * (décrites dans index.ts), et entrée dans la barre latérale au retour.
 */

import { candidates, currentFocus, zoneOf, type Direction } from './dom';
import { lateralOnlyOriginElement, rememberedInRow, rememberedInZone, rememberLateralOnlyOrigin, rowOf } from './focusMemory';
import { closest, gapBeyond } from './geometry';
import { modelTarget } from './modelSearch';

/** Élément à focuser en entrant dans la zone de `target` par un mouvement latéral. */
function zoneEntry(target: HTMLElement, pool: HTMLElement[]): HTMLElement {
  const zone = zoneOf(target);
  const zoneElement = target.closest<HTMLElement>('[data-nav-zone]');
  const active = zoneElement?.querySelector<HTMLElement>('.active');
  const activeEntry = active && pool.includes(active) ? active : null;
  const remembered = rememberedInZone(zone);
  const rememberedEntry = remembered && remembered.isConnected && pool.includes(remembered) ? remembered : null;

  // Barre latérale : toujours l'icône de la page courante
  if (zone === 'sidebar') return activeEntry ?? target;
  return rememberedEntry ?? activeEntry ?? target;
}

/**
 * Colonnes communes à deux rangées superposées (`data-nav-cols="nom"` sur chacune) : Haut/Bas passe à
 * l'élément de même rang dans l'autre rangée, au lieu du dernier élément qu'on y avait quitté
 * (bannière de l'accueil : Lecture ↔ Suggestions, Détails ↔ Films, Watchlist ↔ Séries).
 */
function sameColumnTarget(current: HTMLElement, direction: Direction, pool: HTMLElement[]): HTMLElement | null {
  const from = current.closest<HTMLElement>('[data-nav-cols]');
  if (!from || (direction !== 'up' && direction !== 'down')) return null;
  const name = from.getAttribute('data-nav-cols');
  const fromTop = from.getBoundingClientRect().top;
  const others = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-cols]'))
    .filter((c) => c !== from && c.getAttribute('data-nav-cols') === name)
    .filter((c) => (direction === 'down' ? c.getBoundingClientRect().top > fromTop : c.getBoundingClientRect().top < fromTop));
  if (others.length === 0) return null;
  // L'autre rangée la plus proche dans la direction demandée
  const nearest = others.reduce((a, b) => (Math.abs(a.getBoundingClientRect().top - fromTop) <= Math.abs(b.getBoundingClientRect().top - fromTop) ? a : b));
  const rank = pool.filter((el) => from.contains(el)).indexOf(current);
  const targets = pool.filter((el) => nearest.contains(el));
  if (rank < 0 || targets.length === 0) return null;
  return targets[Math.min(rank, targets.length - 1)];
}

/**
 * Étages alignés (`data-nav-align` sur chacun : carrousels de l'accueil) : Haut/Bas de l'un à l'autre arrive sur
 * l'élément placé dans l'axe de la sélection, pas sur le dernier élément quitté, dans les deux sens. Sans cela, on
 * descendait sur la carte alignée mais on remontait toujours sur la carte quittée plus tôt, ailleurs dans la rangée.
 */
function aligned(current: HTMLElement, target: HTMLElement): boolean {
  return current.closest('[data-nav-align]') !== null && target.closest('[data-nav-align]') !== null;
}

/**
 * Haut/Bas vers l'étage voisin : l'étage le plus proche est atteint même si aucun de ses éléments n'est
 * dans l'axe de la sélection (épisode à droite, étage des saisons et de la source à gauche : la
 * géométrie seule sautait un étage). Dans l'étage : le dernier élément quitté, sinon le plus proche
 * horizontalement. Seuls les étages (`data-nav-row`) comptent ; null quand l'élément choisi par la
 * géométrie n'est pas dans un étage plus lointain, la géométrie décide alors.
 */
function nearestRowTarget(current: HTMLElement, pool: HTMLElement[], direction: Direction): HTMLElement | null {
  if (direction !== 'up' && direction !== 'down') return null;
  const origin = current.getBoundingClientRect();
  const rows = new Map<string | Element, { gap: number; members: HTMLElement[] }>();
  for (const el of pool) {
    const row = rowOf(el);
    if (!row) continue;
    const gap = gapBeyond(origin, el.getBoundingClientRect(), direction);
    if (gap === null) continue;
    const entry = rows.get(row);
    if (entry) {
      entry.gap = Math.min(entry.gap, gap);
      entry.members.push(el);
    } else {
      rows.set(row, { gap, members: [el] });
    }
  }
  let best: { row: string | Element; gap: number; members: HTMLElement[] } | null = null;
  for (const [row, entry] of rows) if (!best || entry.gap < best.gap) best = { row, ...entry };
  if (!best) return null;

  // La géométrie garde la main si son choix n'est pas plus loin que cet étage
  const geometric = closest(current, pool, direction);
  const geometricGap = geometric ? gapBeyond(origin, geometric.getBoundingClientRect(), direction) : null;
  if (geometric && (geometricGap === null || geometricGap <= best.gap + 0.5)) return null;

  const remembered = rememberedInRow(best.row);
  if (remembered && remembered.isConnected && best.members.includes(remembered) && !aligned(current, remembered)) return remembered;
  const centerX = origin.left + origin.width / 2;
  const offset = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.abs(r.left + r.width / 2 - centerX);
  };
  return best.members.reduce((a, b) => (offset(b) < offset(a) ? b : a));
}

/**
 * Points de la bannière (`data-nav-lateral-only`) : ils forment leur propre étage. Depuis une rangée de la
 * bannière (`data-nav-cols`), Droite y mène quand la rangée n'a plus d'élément à droite, toujours sur le
 * premier point, quelle que soit la rangée ; l'élément quitté est retenu. Gauche au bout des points ramène à
 * cet élément ; Haut et Bas suivent les étages voisins.
 */
function lateralOnlyEntry(current: HTMLElement, direction: Direction, pool: HTMLElement[]): HTMLElement | null {
  const row = rowOf(current);
  if (current.hasAttribute('data-nav-lateral-only')) {
    const hasLeftNeighbour = closest(current, pool.filter((el) => el !== current && rowOf(el) === row), direction);
    if (direction !== 'left' || hasLeftNeighbour) return null;
    const origin = lateralOnlyOriginElement();
    return origin && origin.isConnected && pool.includes(origin) && origin.closest('[data-nav-cols]') ? origin : null;
  }
  if (direction !== 'right' || !current.closest('[data-nav-cols]')) return null;
  if (closest(current, pool.filter((el) => el !== current && rowOf(el) === row), direction)) return null;
  const dots = pool.filter((el) => el.hasAttribute('data-nav-lateral-only'));
  if (!closest(current, dots, direction)) return null;
  rememberLateralOnlyOrigin(current);
  return dots.reduce((first, el) => (el.getBoundingClientRect().left < first.getBoundingClientRect().left ? el : first));
}

/** Élément activable suivant dans la direction demandée, selon les règles de zones. */
export function findNextFocusable(current: HTMLElement | null, direction: Direction): HTMLElement | null {
  // Rail recyclé de l'accueil TV : carte suivante trouvée sans mesurer la page (modelSearch.ts)
  const model = current ? modelTarget(current, direction) : null;
  if (model) return model;
  const pool = candidates(current);
  if (pool.length === 0) return null;
  if (!current) return pool.find((el) => zoneOf(el) === 'content') ?? pool[0];

  const columnTarget = sameColumnTarget(current, direction, pool);
  if (columnTarget) return columnTarget;

  const zone = zoneOf(current);
  const dotsTarget = lateralOnlyEntry(current, direction, pool);
  if (dotsTarget) return dotsTarget;
  const vertical = direction === 'up' || direction === 'down';
  // Dans un piège (actions d'une carte), l'étage de la carte ne compte pas
  const trapped = current.closest('[data-nav-trap]') !== null;
  const currentRow = trapped ? null : rowOf(current);
  let zonePool = pool.filter((el) => zoneOf(el) === zone);
  // Éléments marqués `data-nav-lateral-only` (points de la bannière) : atteints seulement par Gauche/Droite
  // depuis leur étage, jamais en arrivant d'un autre étage par Haut/Bas (le retour doit refaire l'aller)
  if (vertical && !trapped) zonePool = zonePool.filter((el) => !el.hasAttribute('data-nav-lateral-only'));
  // Haut/Bas quittent l'étage, même si un de ses éléments est un peu plus haut ou plus bas ;
  // Gauche/Droite y restent (au bout de l'étage, seule la barre latérale reste accessible)
  if (currentRow) zonePool = zonePool.filter((el) => (rowOf(el) === currentRow) !== vertical);

  const inZone = vertical && !trapped ? nearestRowTarget(current, zonePool, direction) ?? closest(current, zonePool, direction) : closest(current, zonePool, direction);
  if (inZone) {
    const row = vertical && !trapped ? rowOf(inZone) : null;
    const remembered = row && !aligned(current, inZone) ? rememberedInRow(row) : undefined;
    return remembered && remembered.isConnected && pool.includes(remembered) ? remembered : inZone;
  }

  // On ne change de zone qu'en butant latéralement, et jamais depuis un piège
  if (vertical || trapped) return null;

  const outside = pool.filter((el) => zoneOf(el) !== zone);
  const target = closest(current, outside, direction);
  return target ? zoneEntry(target, pool) : null;
}

/**
 * Focus sur l'icône de la page courante dans la barre latérale (la première icône si aucune n'est
 * marquée). Retourne false si aucune barre n'est atteignable (fenêtre, connexion, lecteur).
 */
export function focusActiveSidebarEntry(): boolean {
  const pool = candidates(null).filter((el) => zoneOf(el) === 'sidebar');
  if (pool.length === 0) return false;
  const sidebar = pool[0].closest<HTMLElement>('[data-nav-zone]');
  const current = sidebar?.querySelector<HTMLElement>('.active');
  (current && pool.includes(current) ? current : pool[0]).focus({ preventScroll: true });
  return true;
}

/**
 * Dernier recours du retour : focus sur l'icône de la page courante dans la barre latérale.
 * Retourne false si le focus y est déjà, ou si aucune barre n'est atteignable (fenêtre, connexion) :
 * le retour suit alors son cours.
 */
export function focusSidebarEntry(): boolean {
  const active = currentFocus();
  if (active && zoneOf(active) === 'sidebar') return false;
  return focusActiveSidebarEntry();
}
