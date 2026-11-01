/**
 * Places recyclées du rail (accueil Films, Séries et Suggestions TV) : un petit nombre de rangées construites une fois
 * (railRow.ts), qui passent d'une catégorie à l'autre.
 *
 * Une place libérée reste là où elle était, avec son contenu ; pour une catégorie qui arrive, on reprend la place libre
 * la plus éloignée et on la remplit. Une catégorie qui revient avant que sa place ait resservi la retrouve sans être
 * reconstruite ; seules ses affiches, vidées entre-temps au repos, sont reposées.
 *
 * Les places ne sont jamais déplacées dans la page : elles sont dans un calque posé sur la liste des emplacements
 * (un par catégorie, de hauteur fixe), et glissées (`transform`) à la hauteur de leur emplacement. Un élément déplacé
 * dans la page voit les styles de tout ce qu'il contient recalculés (25 ms par rangée au banc réglé comme une petite
 * télé) ; un glissement n'en coûte que 3.
 */

import { createRailRow, type RailRow, type RailRowData, type RailRowLayout } from './railRow';
import { linkRowContent, unlinkRowContent } from '../../../utils/spatialNavigation/rowHost';
import { whenScrollSettled } from '../../../utils/spatialNavigation/scrollAnimator';

/** Hauteur d'une rangée montée, relevée une fois sur la première place remplie, que chaque emplacement réserve (tv.css) */
export const ROW_HEIGHT_VAR = '--rail-row-height';

interface Slot {
  container: HTMLDivElement;
  row: RailRow;
  /** Catégorie affichée, ou null pour une place rangée (sa catégorie a quitté l'accueil) */
  key: string | null;
  /** Rang de cette catégorie dans l'accueil, pour choisir la place libre la plus éloignée */
  index: number;
  /** La catégorie est montée ; sinon la place est libre, son contenu encore là */
  active: boolean;
  /** Version des données avec laquelle la place a été remplie, ou NEVER_FILLED, ou IMAGES_DROPPED */
  filled: number;
  /** Données de la catégorie avec lesquelles la place a été remplie */
  data: RailRowData | null;
}

/** Jamais remplie pour sa catégorie */
const NEVER_FILLED = -1;
/** Remplie, puis vidée de ses affiches au repos */
const IMAGES_DROPPED = -2;

/** Emplacements des catégories de l'accueil, tenus par le rail */
export interface RailPlaces {
  placeOf: (key: string) => HTMLElement | undefined;
  /** Rang de la catégorie dans l'accueil */
  indexOf: (key: string) => number;
}

export interface RailSlots {
  /** La catégorie `key` est montée : une place lui est donnée, posée sur son emplacement et remplie. */
  assign: (key: string) => void;
  /** La catégorie est retirée : sa place devient libre, son contenu reste affiché jusqu'à ce qu'elle resserve. */
  release: (key: string) => void;
  /** Les places libres vident leurs affiches ; une place qui resservira à la même catégorie les reprend. */
  dropIdleImages: () => void;
  /**
   * Nouvelles données : les places montées sont remplies de nouveau, les autres le seront si elles resservent. Une
   * catégorie dont la source rend le même objet qu'avant n'est pas remplie de nouveau (la source garde l'objet d'une
   * catégorie tant qu'elle ne change pas).
   */
  setSource: (source: (key: string) => RailRowData | null) => void;
  /**
   * Emplacements changés (catégories ajoutées, retirées ou déplacées) : hauteurs relues et places replacées. Une place
   * dont la catégorie n'a plus d'emplacement est rangée : cachée et déliée, ses cartes hors de portée de la
   * télécommande, jusqu'à ce qu'elle resserve. Fait aussi tout seul quand la liste change de taille.
   */
  relayout: () => void;
  /** Catégories montées */
  activeKeys: () => string[];
  destroy: () => void;
}

export function createRailSlots(list: HTMLElement, places: RailPlaces, gap?: number, layout?: RailRowLayout): RailSlots {
  const slots: Slot[] = [];
  const layer = document.createElement('div');
  layer.className = 'rail-layer';
  list.appendChild(layer);
  let source: ((key: string) => RailRowData | null) | null = null;
  let version = 0;
  /** Hauteur de chaque emplacement dans la liste, lue une fois pour toutes les places (hauteurs réservées) */
  let tops = new WeakMap<Element, number>();

  const topOf = (place: HTMLElement): number => {
    const known = tops.get(place);
    if (known !== undefined) return known;
    // Avec sa fraction de pixel (offsetTop est arrondi), rapportée à l'échelle de la toile TV. Tous les emplacements
    // d'un coup : une seule mise en page forcée, au lieu d'une à chaque rangée qui arrive
    const box = list.getBoundingClientRect();
    const scale = list.offsetWidth > 0 ? box.width / list.offsetWidth : 1;
    const border = list.clientTop;
    for (const child of Array.from(list.children)) {
      if (child !== layer) tops.set(child, (child.getBoundingClientRect().top - box.top) / scale - border);
    }
    return tops.get(place) ?? 0;
  };

  const put = (slot: Slot, place: HTMLElement) => {
    slot.container.hidden = false;
    slot.container.style.transform = `translateY(${topOf(place)}px)`;
    linkRowContent(place, slot.container);
  };

  const fill = (slot: Slot) => {
    if (!source || slot.key === null || slot.filled === version) return;
    const data = source(slot.key);
    if (!data) return;
    // Mêmes données, déjà affichées : rien à refaire. Sur Suggestions, les données changent souvent (Ma liste, reprises,
    // notes arrivées) pour une seule rangée à la fois
    if (data !== slot.data || slot.filled < 0) {
      // Jamais remplie pour cette catégorie : elle repart de sa première carte (vidée de ses affiches, elle garde sa
      // position)
      slot.row.fill(data, slot.filled === NEVER_FILLED);
    }
    slot.data = data;
    slot.filled = version;
  };

  const relayout = () => {
    tops = new WeakMap();
    for (const slot of slots) {
      const place = slot.key === null ? undefined : places.placeOf(slot.key);
      if (place) {
        slot.index = places.indexOf(slot.key!);
        put(slot, place);
        continue;
      }
      // Catégorie disparue (accueil changé, autre profil) : sa place, cachée, ne garde pas ses affiches en mémoire
      if (slot.key !== null) slot.row.dropImages();
      slot.key = null;
      slot.active = false;
      slot.container.hidden = true;
      unlinkRowContent(slot.container);
    }
  };

  // Hauteur exacte (avec sa fraction de pixel) : arrondie, l'écart s'ajoutait d'une rangée à l'autre
  let reserved = false;
  let destroyed = false;
  let cancelRemeasure: (() => void) | null = null;
  const measure = (container: HTMLElement): boolean => {
    const height = parseFloat(getComputedStyle(container).height);
    if (!(height > 0)) return false;
    const value = `${height}px`;
    if (list.style.getPropertyValue(ROW_HEIGHT_VAR) !== value) {
      list.style.setProperty(ROW_HEIGHT_VAR, value);
      relayout();
    }
    return true;
  };
  const reserveRowHeight = (slot: Slot) => {
    if (reserved || !measure(slot.container)) return;
    reserved = true;
    // Polices pas encore chargées à la première mesure (premier affichage de l'accueil) : la rangée mesurée avec la
    // police de secours était 3 px plus courte, un écart qui s'ajoutait d'une rangée à l'autre. Mesurée de nouveau une
    // fois les polices prêtes, et le défilement arrivé (une hauteur qui change en plein mouvement fausse sa cible)
    const fonts = document.fonts as FontFaceSet | undefined;
    if (!fonts || fonts.status === 'loaded') return;
    fonts.ready.then(() => {
      if (destroyed) return;
      cancelRemeasure = whenScrollSettled(() => {
        cancelRemeasure = null;
        const shown = slots.find((candidate) => candidate.active && !candidate.container.hidden && candidate.filled >= 0);
        if (shown) measure(shown.container);
      });
    }, () => undefined);
  };

  const assign = (key: string) => {
    const place = places.placeOf(key);
    if (!place) return;
    const index = places.indexOf(key);
    let slot = slots.find((candidate) => candidate.key === key);
    if (!slot) {
      // Place libre la plus éloignée de la catégorie demandée (une place rangée d'abord), sinon une place neuve
      const distance = (candidate: Slot) => (candidate.key === null ? Number.POSITIVE_INFINITY : Math.abs(candidate.index - index));
      for (const candidate of slots) {
        if (!candidate.active && (!slot || distance(candidate) > distance(slot))) slot = candidate;
      }
      if (!slot) {
        const container = document.createElement('div');
        container.className = 'rail-slot';
        const row = createRailRow(gap, layout);
        container.appendChild(row.root);
        layer.appendChild(container);
        slot = { container, row, key: null, index, active: false, filled: NEVER_FILLED, data: null };
        slots.push(slot);
      }
      slot.key = key;
      slot.filled = NEVER_FILLED;
      slot.data = null;
    }
    slot.index = index;
    slot.active = true;
    put(slot, place);
    fill(slot);
    reserveRowHeight(slot);
  };

  const release = (key: string) => {
    const slot = slots.find((candidate) => candidate.key === key);
    if (slot) slot.active = false;
  };

  // Liste changée de taille (fenêtre, catégories) : hauteurs relues, places replacées
  let size = '';
  const resize = new ResizeObserver(() => {
    const now = `${list.offsetWidth}x${list.offsetHeight}`;
    if (now === size) return;
    size = now;
    relayout();
  });
  resize.observe(list);

  const dropIdleImages = () => {
    for (const slot of slots) {
      if (slot.active || slot.filled < 0) continue;
      slot.row.dropImages();
      slot.filled = IMAGES_DROPPED;
    }
  };

  return {
    assign,
    release,
    dropIdleImages,
    setSource: (next) => {
      source = next;
      version += 1;
      slots.forEach((slot) => { if (slot.active) fill(slot); });
    },
    relayout,
    activeKeys: () => slots.filter((slot) => slot.active && slot.key !== null).map((slot) => slot.key!),
    destroy: () => {
      destroyed = true;
      cancelRemeasure?.();
      resize.disconnect();
      for (const slot of slots) {
        slot.row.destroy();
        unlinkRowContent(slot.container);
      }
      slots.length = 0;
      layer.remove();
      list.style.removeProperty(ROW_HEIGHT_VAR);
    },
  };
}
