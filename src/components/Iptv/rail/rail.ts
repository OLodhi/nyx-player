/**
 * Rail recyclé : les rangées de l'accueil TV (Films, Séries, Suggestions).
 *
 * Chaque catégorie a un emplacement vide de hauteur fixe dans la liste (`.lazy-category`, gris tant que rien n'y est
 * affiché). Quelques places recyclées (railSlots.ts) y sont posées, construites d'avance d'après la rangée sélectionnée
 * (railWindow.ts) : une seule construction par image, faite dans le rappel d'image lui-même. Touche maintenue, le
 * navigateur fait passer les flèches et les images avant les tâches ordinaires (minuteurs, rendu différé de React) :
 * une construction remise à une tâche ordinaire attendait jusqu'à une seconde, et la rangée arrivait grise à l'écran.
 *
 * Le défilement vertical de la page est joué par le compositeur tant que le rail est affiché (scrollAnimator.ts) : les
 * emplacements ne changent jamais de hauteur, la condition pour que la cible posée au départ reste juste. Pour la même
 * raison, une catégorie qui apparaît ou disparaît (Ma liste, Reprendre) n'est ajoutée ou retirée qu'une fois le
 * défilement arrivé.
 *
 * Un emplacement qui entre près de l'écran sans que la sélection l'ait demandé (premier affichage, retour en haut de
 * page) est construit lui aussi, par la même file.
 */

import { isTv } from '../../../utils/platform';
import { rowPlaceOf } from '../../../utils/spatialNavigation/rowHost';
import { scrollRoot } from '../../../utils/spatialNavigation/dom';
import { playVerticalOnCompositor, whenScrollSettled } from '../../../utils/spatialNavigation/scrollAnimator';
import { releaseAtRest } from '../../../utils/spatialNavigation/navigationRest';
import { createRailSlots } from './railSlots';
import { setPacedPosters } from './railRow';
import { prefetchShrunkPosters } from '../../Lists/tvPoster';
import type { RailRowData, RailRowLayout } from './railRow';
import { RAIL_WINDOW, WIDE_RAIL_WINDOW, directionOf, isFar, overLimit, rowsAround, type Direction, type RailWindow } from './railWindow';

/** Emplacement d'une catégorie (même classe que LazyCategory : hauteur et gris de la rangée pas encore montée) */
export const RAIL_PLACE = 'rail-place';
const PLACE_SELECTOR = `.${RAIL_PLACE}`;
/** Avance de l'observateur sur l'écran, au-dessus et au-dessous (comme LazyCategory) */
const OBSERVER_MARGIN = '800px';

let legacy = false;
/**
 * Version de mesure (src/dev/perfVariants.ts) : `true` rend l'ancien rail, témoin des mesures de comparaison (fenêtre
 * large, affiches posées tout de suite même en mouvement, affiches gardées au repos ; les affiches restent sans fondu
 * et l'ancienne retirée). À l'ouverture suivante de l'accueil.
 */
export function setLegacyRail(on: boolean): void {
  legacy = on;
}

/** Les rangées de l'accueil (Films, Séries, Suggestions) passent-elles par le rail ? Sur TV seulement. */
export function isRailOn(): boolean {
  return isTv();
}

/** Rangées dont les affiches sont préparées d'avance, et délai après le dernier changement des données */
const PREFETCH_ROWS = 15;
const PREFETCH_DELAY_MS = 300;

export type RailSource = (key: string) => RailRowData | null;

export interface Rail {
  /** Catégories de l'accueil, dans l'ordre (appliquées une fois le défilement arrivé) */
  setRows: (keys: readonly string[]) => void;
  /** Données des rangées (changées : les rangées montées sont remplies de nouveau) */
  setSource: (source: RailSource) => void;
  /** Accueil caché par une fiche ou par le lecteur : les rangées de la dernière sélection sont gardées */
  setCovered: (covered: boolean) => void;
  destroy: () => void;
}

export function createRail(list: HTMLElement, gap?: number, layout?: RailRowLayout): Rail {
  // Réglages lus à l'ouverture de l'accueil
  const win: Readonly<RailWindow> = legacy ? WIDE_RAIL_WINDOW : RAIL_WINDOW;
  const dropAtRest = !legacy;
  setPacedPosters(!legacy);
  let keys: readonly string[] = [];
  const placeOfKey = new Map<string, HTMLElement>();
  const keyOfPlace = new Map<Element, string>();
  const indexOfKey = new Map<string, number>();
  const slots = createRailSlots(list, { placeOf: (key) => placeOfKey.get(key), indexOf: (key) => indexOfKey.get(key) ?? -1 }, gap, layout);
  const mounted = new Set<string>();
  let queue: string[] = [];
  let frame: number | null = null;
  let cancelRelease: (() => void) | null = null;
  let lastFocus = -1;
  let direction: Direction = 1;
  /**
   * Repère du plafond quand la sélection est hors du rail (onglets, bannière) : la dernière rangée construite à la
   * demande de l'observateur, c'est-à-dire l'écran. Sans lui, revenir en haut de page sans sélection dans le rail
   * construisait les rangées revenues à l'écran sans en libérer aucune.
   */
  let anchor = -1;

  /** Rang de la catégorie sélectionnée, ou -1 (sélection hors du rail : onglets, bannière, menu) */
  const focusIndex = (): number => {
    const active = document.activeElement;
    const place = active ? rowPlaceOf(active, PLACE_SELECTOR) : null;
    const key = place ? keyOfPlace.get(place) : undefined;
    return key === undefined ? -1 : indexOfKey.get(key) ?? -1;
  };

  const mount = (key: string) => {
    mounted.add(key);
    slots.assign(key);
  };

  const unmount = (key: string) => {
    mounted.delete(key);
    slots.release(key);
  };

  /** Une demande qui arrive en retard (touche maintenue) pour une rangée déjà loin de la sélection n'est plus construite. */
  const stale = (key: string, focus: number): boolean => {
    if (focus >= 0) return isFar(indexOfKey.get(key) ?? -1, focus, win);
    // Sélection hors du rail : seule une rangée encore près de l'écran est construite. Sans ce filtre, un retour en
    // haut de page faisait construire toutes les rangées passées devant l'écran
    const box = placeOfKey.get(key)?.getBoundingClientRect();
    return !box || box.bottom < -innerHeight || box.top > 2 * innerHeight;
  };

  const indexes = (): number[] => [...mounted].map((key) => indexOfKey.get(key) ?? -1);

  /** Accueil caché par une fiche ou par le lecteur, ouverts par-dessus lui (`setCovered`) */
  let covered = false;
  /**
   * Rangée autour de laquelle garder les rangées montées : la sélection ; hors du rail, l'écran (`anchor`) ; accueil
   * caché, la dernière rangée sélectionnée, où la sélection reviendra. Avec l'écran, OK juste avant le repos
   * libérait les rangées autour de la sélection, et la première rangée construite pendant la fiche pouvait prendre
   * l'une de leurs places.
   */
  const referenceRow = (focus: number): number => {
    if (focus >= 0) return focus;
    return covered && lastFocus >= 0 ? lastFocus : anchor;
  };

  /**
   * Une seule construction par image : la prochaine rangée attendue. Au plafond, la rangée montée la plus éloignée est
   * d'abord libérée (un simple marquage), et sa place sert tout de suite à la nouvelle : jamais plus de places que le
   * plafond.
   */
  const step = () => {
    frame = null;
    const focus = focusIndex();
    let key = queue.shift();
    while (key !== undefined && (!placeOfKey.has(key) || mounted.has(key) || stale(key, focus))) key = queue.shift();
    if (focus < 0 && key !== undefined) anchor = indexOfKey.get(key) ?? -1;
    const reference = referenceRow(focus);
    if (key !== undefined) {
      if (mounted.size >= win.max && reference >= 0) {
        const far = overLimit([...indexes(), indexOfKey.get(key) ?? -1], reference, win);
        // La rangée demandée est elle-même la plus éloignée : la construire serait du travail aussitôt défait
        if (far !== null && keys[far] === key) {
          schedule();
          return;
        }
        if (far !== null) unmount(keys[far]);
      }
      mount(key);
      schedule();
      return;
    }
    const far = reference >= 0 ? overLimit(indexes(), reference, win) : null;
    if (far === null) return;
    unmount(keys[far]);
    schedule();
  };

  const schedule = () => {
    if (frame === null && (queue.length > 0 || mounted.size > win.max)) frame = requestAnimationFrame(step);
  };

  /** Au repos de la télécommande : libère les rangées trop loin de la sélection. */
  const releaseFar = () => {
    cancelRelease = null;
    const reference = referenceRow(focusIndex());
    if (reference < 0) return;
    for (const key of [...mounted]) if (isFar(indexOfKey.get(key) ?? -1, reference, win)) unmount(key);
    // Les places libérées vident leurs affiches : la mémoire des images reste bornée à quelques rangées
    if (dropAtRest) slots.dropIdleImages();
  };

  const onFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Element)) return;
    const focus = focusIndex();
    if (focus < 0) return;
    direction = directionOf(lastFocus, focus, direction);
    lastFocus = focus;
    const near = rowsAround(focus, direction, keys.length, win).map((index) => keys[index]).filter((key) => !mounted.has(key));
    // Les demandes de l'observateur encore en attente (rangée près de l'écran hors de la fenêtre) restent, après
    queue = [...near, ...queue.filter((key) => !near.includes(key))];
    schedule();
    cancelRelease ??= releaseAtRest(releaseFar);
  };

  const request = (key: string) => {
    if (mounted.has(key) || queue.includes(key)) return;
    queue.push(key);
    schedule();
  };

  const scroller = scrollRoot(list);
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const key = entry.isIntersecting ? keyOfPlace.get(entry.target) : undefined;
      if (key !== undefined) request(key);
    }
  }, { root: scroller, rootMargin: OBSERVER_MARGIN, threshold: 0 });

  list.addEventListener('focusin', onFocusIn);
  const releaseCompositor = scroller ? playVerticalOnCompositor(scroller) : () => undefined;

  const setRows = (next: readonly string[]) => {
    keys = next;
    indexOfKey.clear();
    next.forEach((key, index) => indexOfKey.set(key, index));
    // Emplacements des catégories parties
    for (const [key, place] of [...placeOfKey]) {
      if (indexOfKey.has(key)) continue;
      observer.unobserve(place);
      place.remove();
      placeOfKey.delete(key);
      keyOfPlace.delete(place);
      mounted.delete(key);
    }
    queue = queue.filter((key) => indexOfKey.has(key));
    // Dans l'ordre de l'accueil, le calque des places après eux
    let before: Element | null = list.firstElementChild;
    for (const key of next) {
      let place = placeOfKey.get(key);
      if (!place) {
        place = document.createElement('div');
        place.className = `lazy-category ${RAIL_PLACE}`;
        placeOfKey.set(key, place);
        keyOfPlace.set(place, key);
        observer.observe(place);
      }
      if (place !== before) list.insertBefore(place, before);
      else before = before.nextElementSibling;
    }
    slots.relayout();
  };

  // Affiches des premières rangées préparées d'avance (réduites par l'appli native quand le réglage est actif) : à la
  // première ouverture, elles sont prêtes quand la descente arrive
  let source: RailSource | null = null;
  let prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  const prefetchSoon = () => {
    if (prefetchTimer !== null) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      prefetchTimer = null;
      const urls = keys.slice(0, PREFETCH_ROWS).flatMap((key) => source?.(key)?.items.map((item) => item.image ?? '') ?? []);
      prefetchShrunkPosters(urls);
    }, PREFETCH_DELAY_MS);
  };

  // Catégories en attente de la fin du défilement : seule la dernière liste compte
  let pendingRows: readonly string[] | null = null;
  let cancelRows: (() => void) | null = null;
  const applyRows = () => {
    cancelRows = null;
    const rows = pendingRows;
    pendingRows = null;
    if (!rows) return;
    setRows(rows);
    prefetchSoon();
  };

  return {
    setRows: (next) => {
      const waiting = pendingRows !== null;
      pendingRows = next;
      if (waiting) return;
      // Premières catégories (rail qui vient d'être créé, pendant un changement d'onglet ou un retour de fiche) : rien
      // au-dessus à préserver, et la sélection a besoin de ses rangées tout de suite
      if (placeOfKey.size === 0) {
        applyRows();
        return;
      }
      // Sans défilement en cours, appliquées tout de suite
      const cancel = whenScrollSettled(applyRows);
      if (pendingRows !== null) cancelRows = cancel;
    },
    setSource: (next) => {
      source = next;
      slots.setSource(next);
      prefetchSoon();
    },
    setCovered: (next) => { covered = next; },
    destroy: () => {
      if (prefetchTimer !== null) clearTimeout(prefetchTimer);
      cancelRows?.();
      prefetchShrunkPosters([]);
      observer.disconnect();
      list.removeEventListener('focusin', onFocusIn);
      if (frame !== null) cancelAnimationFrame(frame);
      cancelRelease?.();
      releaseCompositor();
      slots.destroy();
      placeOfKey.forEach((place) => place.remove());
    },
  };
}
