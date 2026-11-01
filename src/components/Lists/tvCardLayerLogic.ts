/**
 * Calque de sélection d'une rangée de l'accueil TV : le bouton Ma liste et la note, une seule fois par rangée, posés
 * sur la carte qui reçoit la sélection au lieu d'exister dans chacune de ses cartes (rail/railRow.ts).
 *
 * Tout se fait hors de React, au focus : une position, une note et un état Ma liste écrits sur un seul élément, aucun
 * rendu. Les données viennent de la liste de la rangée (le n-ième titre pour la carte n), l'état Ma liste des clés déjà
 * lues pour tout l'accueil (hooks/useWatchlistKeys.ts) : rien n'est demandé à chaque appui.
 *
 * Le calque reprend la place de la carte (son `translateX`, posé en `translate`) et son agrandissement de carte sélectionnée : 1,06 en
 * 120 ms (`scale` de tv.css, rejoué à chaque carte par une animation que le compositeur joue seul), comme la carte.
 */
import { currentWatchlistKeys, onWatchlistKeys } from '../../hooks/useWatchlistKeys';
import { cardHasWatchlist, isItemInWatchlist, overlayStaysOnCard } from './cardWatchlist';
import type { CarouselItem } from './CarouselCard';

/** Agrandissement de la carte sélectionnée (tv.css, `.carousel-card:focus`), repris par le calque. */
export const FOCUSED_CARD_SCALE = 1.06;
/** Durée de l'agrandissement de la carte sélectionnée (tv.css). */
export const FOCUSED_CARD_GROW_MS = 120;

const ADDED = 'watchlist-btn--added';
/**
 * Calque posé sur une nouvelle carte : le bouton Ma liste prend l'état de cette carte sans son animation de bascule
 * (le « + » qui tourne en ✓). Sans cela, passer d'une carte déjà dans Ma liste à une autre montrait une fraction de
 * seconde le ✓ se changer en « + ». L'animation reste pour un vrai ajout ou retrait (appui long).
 */
export const LAYER_MOVING = 'tv-card-layer--moving';

export interface CardLayer {
  /** Recalcule le calque d'après la sélection du moment (liste ou taille de la rangée changées). */
  refresh: () => void;
  /** Détache tout. */
  detach: () => void;
}

/**
 * Relie le calque `layer` à la piste `track` d'une rangée. `itemAt(i)` : titre de la carte n° i (lu au moment du
 * focus, la liste peut avoir changé).
 */
export function attachCardLayer(
  track: HTMLElement,
  layer: HTMLElement,
  itemAt: (index: number) => CarouselItem | undefined,
): CardLayer {
  const button = layer.querySelector<HTMLElement>('.card-watchlist-btn');
  const rating = layer.querySelector<HTMLElement>('.card-overlay-text');
  let shown: CarouselItem | null = null;
  let movingFrame = 0;

  const hide = () => {
    shown = null;
    layer.hidden = true;
  };

  const showWatchlist = (item: CarouselItem) => {
    if (!button) return;
    button.hidden = !cardHasWatchlist(item);
    button.classList.toggle(ADDED, isItemInWatchlist(item, currentWatchlistKeys()));
  };

  /** Pose le calque sur `target` (élément focusé) ; `grow` : rejoue l'agrandissement (nouvelle carte). */
  const place = (target: Element | null, grow: boolean) => {
    const card = target instanceof HTMLElement && track.contains(target) ? target.closest<HTMLElement>('.carousel-card') : null;
    const slot = card?.parentElement;
    const index = slot?.getAttribute('data-index');
    const item = index == null ? undefined : itemAt(Number(index));
    if (!card || !slot || !item || item.isActionButton || layer.contains(card)) {
      hide();
      return;
    }
    shown = item;
    // Décalage de la carte posé par le virtualiseur, en `translate` : appliqué avant le `scale` de tv.css (un
    // `transform` viendrait après lui et serait agrandi aussi, le calque glisserait à droite de la carte)
    layer.style.translate = /translateX\(([-\d.]+)px\)/.exec(slot.style.transform)?.[1].concat('px') ?? '0px';
    if (rating) {
      const text = overlayStaysOnCard(item) ? '' : item.overlayText ?? '';
      rating.textContent = text;
      rating.hidden = !text;
    }
    if (grow) {
      layer.classList.add(LAYER_MOVING);
      cancelAnimationFrame(movingFrame);
      // Retirée seulement à la deuxième image : les rappels d'image passent avant le calcul de style de leur image,
      // un retrait dès la première rejouerait la transition. À la deuxième, le nouvel état est déjà calculé sans elle
      movingFrame = requestAnimationFrame(() => {
        movingFrame = requestAnimationFrame(() => layer.classList.remove(LAYER_MOVING));
      });
    }
    showWatchlist(item);
    layer.hidden = false;
    if (grow) layer.animate?.([{ scale: '1' }, { scale: String(FOCUSED_CARD_SCALE) }], { duration: FOCUSED_CARD_GROW_MS, easing: 'ease-out' });
  };

  const onFocusIn = (event: FocusEvent) => place(event.target as Element, true);

  const onFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !track.contains(next)) hide();
  };

  // Ma liste modifiée (appui long sur la carte sélectionnée, synchro) : le bouton du calque suit
  const stopKeys = onWatchlistKeys(() => { if (shown) showWatchlist(shown); });

  track.addEventListener('focusin', onFocusIn);
  track.addEventListener('focusout', onFocusOut);
  hide();
  return {
    refresh: () => place(document.activeElement, false),
    detach: () => {
      track.removeEventListener('focusin', onFocusIn);
      track.removeEventListener('focusout', onFocusOut);
      stopKeys();
      cancelAnimationFrame(movingFrame);
    },
  };
}
