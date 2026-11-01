/**
 * useGuideTvRemote — Guide TV à la télécommande (Android TV).
 *
 * Le corps du guide porte `data-nav-grid` : la navigation spatiale lui confie les flèches
 * (`nyx:nav-move`) et il choisit la case suivante comme un décodeur (utils/guideTvNavigation.ts).
 * OK sur un logo ou un programme lance la chaîne, en direct. Retour suit la règle commune.
 *
 * Une seule case du guide est sur le parcours à la fois (`tabindex="0"`, les autres à -1) : en
 * revenant de la barre des catégories, on retrouve la case quittée. Le focus se déplace sans
 * rendu React. La grille ne dessine que ce qui est à l'écran : une case visée hors de l'écran est
 * d'abord dessinée (`revealCell`), puis sélectionnée.
 *
 * Rechargement (synchro des programmes) : la grille est remplacée par l'écran de chargement, la case
 * sélectionnée disparaît avec elle. La sélection revient ensuite sur la même chaîne, au même
 * programme (ou à celui qui couvre la même heure), avec l'heure suivie d'avant. Seul le jour même
 * est rechargé : un programme du lendemain cède la place au plus proche de la chaîne ; une chaîne
 * disparue, au programme en cours de la première.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { IptvStream } from '../types/iptv';
import type { EpgProgram } from '../services/epgService';
import { isKeyRepeat, type NavMoveDetail } from '../utils/spatialNavigation';
import { animateScrollTo, screenScale } from '../utils/spatialNavigation/scrollAnimator';
import { nextGuideCell, programAt, type GuideCell, type GuideNavState } from '../utils/guideTvNavigation';

interface UseGuideTvRemoteOptions {
  /** Corps du guide (null pendant le chargement) */
  body: HTMLDivElement | null;
  /** Interface TV : sinon le hook ne fait rien */
  enabled: boolean;
  channels: IptvStream[];
  /** Programmes affichables de chaque rangée, triés par début */
  rows: EpgProgram[][];
  onChannelClick: (channel: IptvStream) => void;
  /**
   * Fait dessiner une case hors de la partie dessinée de la grille. `sync` : dessinée avant le retour
   * de l'appel (flèche en cours) ; sinon au rendu suivant, signalé par un nouveau `rendered`.
   */
  revealCell?: (cell: GuideCell, sync: boolean) => void;
  /** Change quand la partie dessinée de la grille change */
  rendered?: unknown;
}

/** Sélecteur d'une case : logo (`data-guide-channel`) ou programme (`data-guide-start`). */
function cellSelector(cell: GuideCell): string {
  return cell.startTs === null
    ? `[data-guide-row="${cell.row}"][data-guide-channel]`
    : `[data-guide-row="${cell.row}"][data-guide-start="${cell.startTs}"]`;
}

/** Case sélectionnée, retenue par chaîne : les rangées sont recalculées au rechargement. */
interface Selection {
  streamId: IptvStream['stream_id'];
  startTs: number | null;
}

/** Plus rien n'a le focus : la case sélectionnée a été retirée de la page. */
function focusLost(): boolean {
  return !document.activeElement || document.activeElement === document.body;
}

function readCell(body: HTMLElement, target: EventTarget | null): GuideCell | null {
  const element = target instanceof Element ? target.closest<HTMLElement>('[data-guide-row]') : null;
  if (!element || !body.contains(element)) return null;
  const start = element.dataset.guideStart;
  return { row: Number(element.dataset.guideRow), startTs: start === undefined ? null : Number(start) };
}

/**
 * Défilement du corps du guide (pixels de mise en page) qui amène le centre de la case au centre du
 * corps. Les rectangles sont mesurés à l'écran, les défilements en pixels de mise en page : identiques
 * tant que la page n'est pas réduite (cas actuel). Avec une ancienne réduction de 0,9 (retirée depuis),
 * la ligne visée tombait 5 % trop bas sans conversion ; la conversion reste, sans effet à l'échelle 1.
 */
export function channelCenterOffset(body: HTMLElement, cellRect: DOMRect): number {
  const bodyRect = body.getBoundingClientRect();
  const scale = screenScale(bodyRect.height, body.offsetHeight);
  const middle = bodyRect.top + (body.clientTop + body.clientHeight / 2) * scale;
  return (cellRect.top + cellRect.height / 2 - middle) / scale;
}

/**
 * Logo d'une chaîne : la colonne reste collée à gauche, seul le défilement vertical suit. Avec
 * `scrollIntoView`, le logo collé passait pour caché sous la colonne et la grille reculait d'environ
 * 40 minutes à chaque Haut / Bas.
 */
function focusChannelCell(body: HTMLElement, cell: HTMLElement, instant: boolean): void {
  cell.focus({ preventScroll: true });
  const offset = channelCenterOffset(body, cell.getBoundingClientRect());
  // Même règle que la sélection dans les programmes (viewScroll.ts) : tout le guide suit la même règle
  if (offset !== 0) animateScrollTo(body, { top: body.scrollTop + offset }, { instant });
}

/** Case de la grille, dessinée au besoin. */
function findCell(
  body: HTMLElement,
  cell: GuideCell,
  revealCell: UseGuideTvRemoteOptions['revealCell'],
): HTMLElement | null {
  const found = body.querySelector<HTMLElement>(cellSelector(cell));
  if (found || !revealCell) return found;
  revealCell(cell, true);
  return body.querySelector<HTMLElement>(cellSelector(cell));
}

export function useGuideTvRemote({
  body,
  enabled,
  channels,
  rows,
  onChannelClick,
  revealCell,
  rendered,
}: UseGuideTvRemoteOptions): void {
  const latest = useRef({ channels, rows, onChannelClick, revealCell });
  useLayoutEffect(() => {
    latest.current = { channels, rows, onChannelClick, revealCell };
  });
  /** Heure suivie : 0 = pas encore fixée, c'est alors maintenant */
  const state = useRef<GuideNavState>({ anchorTs: 0, resumePrograms: false });
  /** Case sur le parcours (`tabindex="0"`) */
  const entry = useRef<HTMLElement | null>(null);
  /** Case sélectionnée tant que la sélection est dans le guide, à reprendre après un rechargement */
  const selection = useRef<Selection | null>(null);

  // Flèches, OK, et case d'entrée qui suit la sélection
  useEffect(() => {
    if (!enabled || !body) return;
    // Nouveau guide : la sélection, perdue avec l'ancienne grille, sera reprise (rechargement) ; sinon
    // (autre catégorie, choisie depuis la barre) on repart du programme en cours
    if (!selection.current || !focusLost()) {
      selection.current = null;
      state.current = { anchorTs: 0, resumePrograms: false };
    }

    const handleMove = (event: Event) => {
      const detail = (event as CustomEvent<NavMoveDetail>).detail;
      const from = readCell(body, document.activeElement);
      if (!from) return;
      const { rows: current } = latest.current;
      const nowSec = Math.floor(Date.now() / 1000);
      if (state.current.anchorTs === 0) state.current = { ...state.current, anchorTs: nowSec };
      const move = nextGuideCell(
        from,
        detail.direction,
        current.length,
        (row) => current[row] ?? [],
        state.current,
        nowSec,
      );
      if (!move) return;
      event.preventDefault();
      state.current = move.state;
      const target = move.cell ? findCell(body, move.cell, latest.current.revealCell) : null;
      if (target && move.cell?.startTs === null) focusChannelCell(body, target, false);
      else detail.next = target;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || isKeyRepeat(event)) return;
      const cell = readCell(body, event.target);
      const channel = cell ? latest.current.channels[cell.row] : undefined;
      if (!channel) return;
      event.preventDefault();
      latest.current.onChannelClick(channel);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-guide-row]') : null;
      const cell = element ? readCell(body, element) : null;
      const channel = cell ? latest.current.channels[cell.row] : undefined;
      if (cell && channel) selection.current = { streamId: channel.stream_id, startTs: cell.startTs };
      if (!element || element === entry.current) return;
      entry.current?.setAttribute('tabindex', '-1');
      element.setAttribute('tabindex', '0');
      entry.current = element;
    };

    // Sélection partie ailleurs (barre des catégories…) : rien à reprendre. Sans destination (case
    // retirée de la page, fenêtre en arrière-plan), elle reste à reprendre.
    const handleFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !body.contains(event.relatedTarget)) selection.current = null;
    };

    body.addEventListener('nyx:nav-move', handleMove);
    body.addEventListener('keydown', handleKeyDown);
    body.addEventListener('focusin', handleFocusIn);
    body.addEventListener('focusout', handleFocusOut);
    return () => {
      body.removeEventListener('nyx:nav-move', handleMove);
      body.removeEventListener('keydown', handleKeyDown);
      body.removeEventListener('focusin', handleFocusIn);
      body.removeEventListener('focusout', handleFocusOut);
    };
  }, [enabled, body]);

  // Case d'entrée : à l'arrivée, le programme en cours de la première chaîne (sinon son logo). Après
  // un rechargement, la case qui était sélectionnée, qui reprend le focus.
  useEffect(() => {
    if (!enabled || !body || entry.current?.isConnected) return;
    const restore = selection.current && focusLost() ? selection.current : null;
    const restoreRow = restore ? latest.current.channels.findIndex((ch) => ch.stream_id === restore.streamId) : -1;
    let cell: GuideCell;
    if (restore && restoreRow >= 0) {
      const program = restore.startTs === null ? undefined : programAt(rows[restoreRow] ?? [], restore.startTs);
      cell = { row: restoreRow, startTs: program ? program.startTs : null };
    } else {
      const live = programAt(rows[0] ?? [], state.current.anchorTs || Math.floor(Date.now() / 1000));
      cell = { row: 0, startTs: live ? live.startTs : null };
    }
    const target = body.querySelector<HTMLElement>(cellSelector(cell));
    if (!target) {
      // Hors de la partie dessinée (sélection reprise loin du haut) : dessinée au rendu suivant, qui
      // relance cet effet (`rendered`)
      latest.current.revealCell?.(cell, false);
      return;
    }
    target.setAttribute('tabindex', '0');
    entry.current = target;
    if (!restore) return;
    // Défilement instantané : la grille vient d'apparaître, sur l'heure actuelle
    if (cell.startTs === null) {
      focusChannelCell(body, target, true);
    } else {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    }
  }, [enabled, body, rows, rendered]);
}
