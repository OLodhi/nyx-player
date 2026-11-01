/**
 * Une rangée de l'accueil TV (Films, Séries, Suggestions) écrite directement dans la page, sans React, pour être
 * recyclée d'une catégorie à l'autre (railSlots.ts).
 *
 * Sur une petite télé, React coûtait environ 60 % de la construction d'une rangée : il crée et compare chaque élément
 * de ses onze cartes, alors que le navigateur seul les crée deux fois plus vite, et qu'une rangée réutilisée ne demande
 * que de changer titres et affiches. Ici, une rangée est construite une fois, puis remplie à chaque catégorie : mêmes
 * éléments, mêmes classes et mêmes repères que la rangée React de bureau (VirtualContentCarousel, CarouselCard,
 * CardPoster), pour que le style, la navigation à la télécommande et le calque de sélection (tvCardLayerLogic.ts)
 * marchent de la même façon. La rangée n'est pas virtualisée : ses cartes restent construites, par tranches pour une
 * longue rangée (Ma liste, Reprendre), la suivante quand la sélection approche du bout.
 *
 * Deux présentations : celle des catégories du fournisseur (Films, Séries : en-tête de catégorie) et celle des
 * carrousels de Suggestions (titre dans le carrousel, comme VirtualDashboardRow), avec la barre de progression et le
 * bouton lecture des cartes « Reprendre » et la rangée d'attente du chargement.
 *
 * Les gestes passent par un seul écouteur par rangée : OK ou clic ouvre la carte, l'appui long change Ma liste, le focus
 * marque un titre trop long.
 */

import { carouselDims } from '../../Lists/VirtualContentCarousel';
import type { CarouselItem } from '../../Lists/CarouselCard';
import { attachCardLayer, type CardLayer } from '../../Lists/tvCardLayerLogic';
import { cardHasWatchlist, isItemInWatchlist, overlayStaysOnCard, toggleCardWatchlist } from '../../Lists/cardWatchlist';
import { currentWatchlistKeys, onWatchlistKeys } from '../../../hooks/useWatchlistKeys';
import { markTitleOverflowSoon } from '../../Lists/cardTitle';
import { fallbackPosterSrc, onPosterSettled, tvPosterSrc } from '../../Lists/tvPoster';
import { NOT_YET, isMoving, isServingWhileMoving, whenStill } from '../../../utils/spatialNavigation/navigationRest';
import { warnOnReject } from '../../../utils/warnOnReject';
import { forgetRow } from '../../../utils/spatialNavigation/focusMemory';

export interface RailRowData {
  title: string;
  items: CarouselItem[];
  /** Titre du bouton Ma liste du calque de sélection */
  watchlistLabel: string;
  /** Données encore en chargement : la rangée attend, grise (présentation des carrousels seulement) */
  loading?: boolean;
}

/** `category` : rangée d'une catégorie du fournisseur (Films, Séries) ; `carousel` : carrousel de Suggestions */
export type RailRowLayout = 'category' | 'carousel';

/** Cartes construites d'un coup, puis à chaque tranche */
export const CARD_BATCH = 12;
/** La tranche suivante est construite quand la sélection arrive à moins de tant de cartes de la dernière construite */
export const CARD_BATCH_AHEAD = 6;
/** Cadres gris d'une rangée en chargement (comme les cartes d'attente de VirtualContentCarousel) */
const LOADING_FRAMES = 6;

let pacedPosters = true;
/**
 * Version de mesure (src/dev/perfVariants.ts) : `false` rend l'ancien comportement, chaque affiche posée tout de suite,
 * même en plein mouvement et loin à droite de l'écran, pour servir de témoin aux mesures de comparaison.
 */
export function setPacedPosters(on: boolean): void {
  pacedPosters = on;
}

let bareWaitingCard = true;
/**
 * Version de mesure (src/dev/perfVariants.ts, avec sa règle de perfVariants.css) : `false` rend l'image d'avant,
 * montrée pendant son chargement et avec le titre en texte de remplacement (témoin de la case grise nue).
 */
export function setBareWaitingCard(on: boolean): void {
  bareWaitingCard = on;
}

/**
 * Carte sans affiche (en attente, ou vidée au repos) : l'image reste dans la carte, sans adresse. Chromium dessinerait
 * son icône « image cassée » sur une image qui a perdu son adresse : tv.css la cache (`img:not([src])`), sans script.
 * Garder l'image dans la carte plutôt que l'en retirer : au banc, la retirer puis la remettre à chaque affiche coûtait
 * des images au défilement.
 */
function blankPoster(img: HTMLImageElement): void {
  img.removeAttribute('src');
  // Témoin des mesures : rien de caché pendant le chargement, ni texte de remplacement sur la case vide (version B)
  if (bareWaitingCard) return;
  if (img.style.visibility) img.style.visibility = '';
  img.alt = '';
}

export interface RailRow {
  root: HTMLElement;
  /** Vide les affiches de la rangée (place libérée au repos) ; le remplissage suivant les repose. */
  dropImages: () => void;
  /**
   * Remplit la rangée. `fresh` : elle passe à une autre catégorie, elle repart de sa première carte ; sinon (mêmes
   * titres relus après une synchro) elle garde sa position et sa sélection.
   */
  fill: (data: RailRowData, fresh: boolean) => void;
  /** Détache le calque et les abonnements */
  destroy: () => void;
}

/** Bouton Ma liste du calque de sélection (WatchlistButton, taille sm, hors du parcours) */
const LAYER_BUTTON = '<button class="watchlist-btn watchlist-btn--sm card-watchlist-btn" type="button" tabindex="-1"'
  + ' data-testid="carousel-card-layer-watchlist"><svg class="watchlist-btn__icon watchlist-btn__icon--plus"'
  + ' viewBox="0 0 161.12 161.12" fill="currentColor"><polygon points="161.12 70.56 90.56 70.56 90.56 0 70.56 0 70.56'
  + ' 70.56 0 70.56 0 90.56 70.56 90.56 70.56 161.12 90.56 161.12 90.56 90.56 161.12 90.56 161.12 70.56"></polygon>'
  + '</svg><svg class="watchlist-btn__icon watchlist-btn__icon--check" viewBox="0 0 174.74 159.46" fill="currentColor">'
  + '<polygon points="62.56 159.46 0 67.99 16.51 56.7 63.43 125.31 158.83 0 174.74 12.12 62.56 159.46"></polygon>'
  + '</svg></button>';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

interface CardParts {
  slot: HTMLDivElement;
  card: HTMLDivElement;
  wrapper: HTMLDivElement;
  badge: HTMLDivElement;
  img: HTMLImageElement;
  placeholder: HTMLDivElement;
  overlay: HTMLDivElement;
  titleBox: HTMLDivElement;
  title: HTMLSpanElement;
  /** Copie du titre pour la boucle de défilement */
  copy: HTMLSpanElement;
  /** Affiche introuvable : le titre la remplace tant que l'adresse ne change pas, comme CardPoster */
  failed: string | null;
  /** Attente d'une affiche réduite pas encore prête */
  unsettle: (() => void) | null;
  /** Barre de progression et bouton lecture (cartes « Reprendre »), construits à la première carte qui en a besoin */
  resume: ResumeParts | null;
}

interface ResumeParts {
  bar: HTMLDivElement;
  fill: HTMLDivElement;
  play: HTMLDivElement;
}

function buildCard(index: number, left: number, width: number, height: number): CardParts {
  const slot = element('div');
  slot.setAttribute('data-index', String(index));
  slot.style.cssText = `position:absolute;top:0;left:0;pointer-events:auto;width:${width}px;height:${height}px;transform:translateX(${left}px)`;
  const card = element('div', 'carousel-card');
  card.setAttribute('data-testid', 'carousel-card');
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const wrapper = element('div', 'card-image-wrapper');
  const badge = element('div');
  const img = element('img');
  img.draggable = false;
  img.loading = 'lazy';
  // Sans texte de remplacement : le titre est déjà sur la carte (aria-label, barre du titre), et la WebView le
  // dessinerait sur la case grise avec son icône « image » tant que l'affiche charge
  img.alt = '';
  const placeholder = element('div', 'card-placeholder-title');
  placeholder.appendChild(element('span'));
  const overlay = element('div', 'card-overlay-text');
  const bottom = element('div', 'card-bottom-bar');
  const row = element('div', 'title-row');
  const titleBox = element('div', 'card-title marquee-container');
  const title = element('span', 'title-text');
  const copy = element('span', 'title-text title-text--copy');
  copy.setAttribute('aria-hidden', 'true');
  titleBox.append(title, copy);
  row.appendChild(titleBox);
  bottom.appendChild(row);
  card.append(wrapper, bottom);
  slot.appendChild(card);
  return { slot, card, wrapper, badge, img, placeholder, overlay, titleBox, title, copy, failed: null, unsettle: null, resume: null };
}

/**
 * Remplit une carte, en ne touchant qu'à ce qui change (une rangée recyclée garde ses éléments). `rank` : rang déjà lu
 * (posterRank, lu pour toute la rangée avant de la remplir), ou servi par la file des affiches (`SERVED`) ; sans lui, il
 * est lu ici si besoin.
 */
function fillCard(parts: CardParts, item: CarouselItem, keys: Set<string> | null, rank?: number): void {
  const { card, badge, img, placeholder } = parts;
  const classes = ['carousel-card'];
  if (item.isActionButton) classes.push('action-button');
  if (item.unavailable) classes.push('carousel-card--unavailable');
  if (isItemInWatchlist(item, keys)) classes.push('carousel-card--in-watchlist');
  const className = classes.join(' ');
  if (card.className !== className) card.className = className;
  if (item.mediaType) card.setAttribute('data-media-type', item.mediaType);
  else card.removeAttribute('data-media-type');
  const watchlist = cardHasWatchlist(item);
  card.toggleAttribute('data-watchlist', watchlist);
  card.toggleAttribute('data-nav-longpress', watchlist);
  card.setAttribute('aria-label', item.title);
  card.removeAttribute('data-title-overflow');

  const nodes: Node[] = [];
  if (item.mediaType) {
    badge.className = `card-media-badge ${item.mediaType}`;
    nodes.push(badge);
  }
  parts.unsettle?.();
  parts.unsettle = null;
  const src = item.image ? tvPosterSrc(item.image) : '';
  if (src === null) {
    // Affiche en cours de réduction : case grise d'ici là, sans l'ancienne affiche d'une carte recyclée
    blankPoster(img);
    nodes.push(img);
    const image = item.image!;
    parts.unsettle = onPosterSettled(image, () => {
      parts.unsettle = settleSoon((rank) => {
        parts.unsettle = null;
        fillCard(parts, item, currentWatchlistKeys(), rank);
      }, parts.card);
    });
  } else if (src && src !== parts.failed) {
    parts.failed = null;
    // Carte recyclée : l'ancienne affiche resterait visible jusqu'à l'arrivée de la nouvelle. Elle est retirée (case
    // vide) plutôt que cachée par l'opacité : chaque bascule d'opacité coûtait des images pendant le défilement
    if (img.getAttribute('src') !== src) {
      img.removeAttribute('src');
      if (pacedPosters && rank !== SERVED && ((isMoving() && !isServingWhileMoving()) || (rank ?? posterRank(card)) === NOT_YET)) {
        // En plein mouvement, ou loin à droite de l'écran : la carte attend son tour, case grise (rangée sélectionnée et
        // cartes à l'écran pendant le mouvement, le reste à l'arrêt, ce qui est au-delà du bord droit quand il arrive à
        // l'écran)
        blankPoster(img);
        nodes.push(img);
        parts.unsettle = whenStill(() => {
          parts.unsettle = null;
          fillCard(parts, item, currentWatchlistKeys(), SERVED);
        }, () => posterRank(parts.card));
        finishCard(parts, item, nodes);
        return;
      }
      img.src = src;
    } else if (bareWaitingCard && img.complete && img.naturalWidth === 0) {
      // Échec arrivé pendant que la carte était hors de la rangée (tranche retirée d'une rangée recyclée), son `error`
      // perdu : même suite qu'un échec, l'adresse d'origine, sinon le titre
      const original = fallbackPosterSrc(src);
      if (original) img.src = original;
      else {
        parts.failed = src;
        placeholder.firstElementChild!.textContent = item.title;
        nodes.push(placeholder);
        finishCard(parts, item, nodes);
        return;
      }
    }
    // Tant qu'elle charge, l'image reste invisible : sur la box, la WebView y dessinait son icône « image ». Rendue
    // visible à son arrivée (écoute `load` de la rangée), sans fondu ni bascule d'opacité ; ou ici, arrivée pendant que
    // la carte était hors de la rangée, son `load` perdu
    const visibility = img.complete || !bareWaitingCard ? '' : 'hidden';
    if (img.style.visibility !== visibility) img.style.visibility = visibility;
    const alt = bareWaitingCard ? '' : item.title;
    if (img.alt !== alt) img.alt = alt;
    nodes.push(img);
  } else {
    placeholder.firstElementChild!.textContent = item.title;
    nodes.push(placeholder);
  }
  finishCard(parts, item, nodes);
}

/** Rang d'une carte servie par la file des affiches : son tour est venu, elle reçoit son affiche */
const SERVED = -1;

/** Affiches réduites prêtes, remplies ensemble à la fin de la tâche */
const settled: { fill: (rank?: number) => void; card: HTMLElement; live: boolean }[] = [];

/**
 * Une affiche réduite est prête : l'appli native les annonce par lots, toutes dans la même tâche (tvPoster.ts). Leurs
 * cartes sont remplies ensemble juste après, rangs lus en une passe avant toute écriture : lus carte par carte, chacun
 * aurait suivi l'écriture de la carte précédente et forcé une mise en page. Renvoie l'annulation.
 */
function settleSoon(fill: (rank?: number) => void, card: HTMLElement): () => void {
  const entry = { fill, card, live: true };
  if (settled.length === 0) queueMicrotask(flushSettled);
  settled.push(entry);
  return () => {
    entry.live = false;
  };
}

function flushSettled(): void {
  const batch = settled.splice(0).filter((entry) => entry.live);
  // En plein mouvement, rien à lire : les cartes attendent la file des affiches
  const ranks = pacedPosters && !isMoving() ? batch.map((entry) => posterRank(entry.card)) : null;
  batch.forEach((entry, index) => entry.fill(ranks?.[index]));
}

/**
 * Ordre des affiches qui attendent leur tour : 0 rangée sélectionnée, 1 carte à l'écran, 2 hors de l'écran en hauteur.
 * Au-delà du bord droit de l'écran (de l'écran suivant pour la rangée sélectionnée), NOT_YET : la carte attend d'arriver
 * à l'écran. Seule exception, la rangée où la sélection s'arrête : toutes ses cartes viennent à l'arrêt (rang 2, après
 * ce qui est à l'écran ailleurs), prêtes quand on la parcourt.
 */
function posterRank(card: HTMLElement): number {
  const active = document.activeElement;
  const selected = !!active && !!card.closest('.rail-slot')?.contains(active);
  const box = card.getBoundingClientRect();
  if (box.left >= innerWidth * (selected ? 2 : 1)) return selected && !isMoving() ? 2 : NOT_YET;
  if (selected) return 0;
  return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth ? 1 : 2;
}

/** Fin du remplissage d'une carte : texte posé sur l'affiche, enfants et titres */
function finishCard(parts: CardParts, item: CarouselItem, nodes: Node[]): void {
  const { wrapper, overlay } = parts;
  if (overlayStaysOnCard(item) && item.overlayText) {
    overlay.textContent = item.overlayText;
    nodes.push(overlay);
  }
  // Mêmes enfants qu'avant : rien à changer dans l'arbre (le cas de toutes les cartes d'affiche)
  const same = wrapper.childNodes.length === nodes.length && nodes.every((node, i) => wrapper.childNodes[i] === node);
  if (!same) wrapper.replaceChildren(...nodes);
  if (parts.title.textContent !== item.title) parts.title.textContent = item.title;
  if (parts.copy.textContent !== item.title) parts.copy.textContent = item.title;
}

/**
 * Barre de progression et bouton lecture d'une carte « Reprendre » (CardPoster). Posés dans la carte, entre l'affiche et
 * la barre du titre : même place à l'écran et même ordre de dessin que dans la carte React, sans toucher aux enfants de
 * l'affiche, que la file des affiches remplit à son rythme. Une carte recyclée vers une autre rangée les perd : le banc
 * ne choisit une carte à ouvrir que si elle n'en a pas (elle lancerait la lecture).
 */
function fillResume(parts: CardParts, item: CarouselItem): void {
  const progress = item.progress;
  const play = !!item.showPlayButton;
  if (progress === undefined && !play && !parts.resume) return;
  if (!parts.resume) {
    const bar = element('div', 'card-progress-bar');
    bar.setAttribute('data-testid', 'carousel-card-progress');
    const fill = element('div', 'progress-fill');
    bar.appendChild(fill);
    const button = element('div', 'card-play-button');
    button.setAttribute('data-testid', 'carousel-card-play');
    const icon = element('span', 'play-icon');
    icon.textContent = '▶';
    button.appendChild(icon);
    parts.resume = { bar, fill, play: button };
  }
  const { bar, fill, play: button } = parts.resume;
  const before = parts.wrapper.nextSibling;
  if (progress === undefined) bar.remove();
  else {
    const width = `${Math.min(100, Math.max(0, progress))}%`;
    if (fill.style.width !== width) fill.style.width = width;
    if (bar.parentElement !== parts.card) parts.card.insertBefore(bar, before);
  }
  if (!play) button.remove();
  else if (button.parentElement !== parts.card) parts.card.insertBefore(button, bar.parentElement ? bar.nextSibling : before);
}

/** Une affiche introuvable laisse place au titre, comme CardPoster */
function showPlaceholder(parts: CardParts, item: CarouselItem | undefined): void {
  if (!item) return;
  parts.failed = parts.img.getAttribute('src');
  parts.placeholder.firstElementChild!.textContent = item.title;
  parts.img.replaceWith(parts.placeholder);
}

export function createRailRow(gap?: number, layout: RailRowLayout = 'category'): RailRow {
  const dims = carouselDims(gap);
  const itemWidth = dims.cardW + dims.gapPx;
  const carousel = layout === 'carousel';
  // Catégorie : en-tête de catégorie au-dessus du carrousel (titre du carrousel caché, IptvMode.css). Carrousel de
  // Suggestions : le titre dans le carrousel, comme VirtualDashboardRow (le banc y lit le nom de la rangée)
  const root = element('div', carousel ? 'rail-carousel-row' : 'iptv-category-section');
  if (!carousel) root.setAttribute('data-testid', 'iptv-category');
  // Haut / Bas d'une catégorie à l'autre arrive sur la carte dans l'axe (spatialNavigation)
  root.setAttribute('data-nav-align', '');
  const header = element('div', 'iptv-category-header');
  const heading = element('h3', 'iptv-category-title');
  header.appendChild(heading);
  const container = element('div', 'content-carousel-container');
  container.setAttribute('data-row-title', '');
  container.style.contentVisibility = 'visible';
  const carouselTitle = element('h3', 'carousel-title');
  carouselTitle.setAttribute('data-testid', 'carousel-row-title');
  // Rangée en chargement : barre grise posée sur le titre et cadres gris immobiles, sans repère du banc (ce décor
  // n'est pas une vraie rangée). Le titre reste en place, vide : la rangée garde la
  // hauteur d'une rangée remplie (la barre grise est plus basse que le titre), celle que
  // réservent tous les emplacements du rail
  const loadingTitle = element('div', 'carousel-title skeleton-title');
  const track = element('div', 'content-carousel');
  track.setAttribute('data-testid', 'carousel-row-track');
  track.setAttribute('data-nav-row', 'true');
  track.style.cssText = `display:block;height:${dims.totalH}px;position:relative;padding:0`;
  const inner = element('div');
  inner.style.cssText = `height:${dims.cardH}px;position:relative;margin-top:${dims.paddingTop}px;margin-left:var(--sidebar-safe-zone)`;
  const layer = element('div', 'tv-card-layer');
  layer.setAttribute('data-testid', 'carousel-card-layer');
  layer.setAttribute('aria-hidden', 'true');
  layer.style.cssText = `width:${dims.cardW}px;height:${dims.cardH}px`;
  layer.innerHTML = `<div class="card-overlay-text"></div>${LAYER_BUTTON}`;
  const layerButton = layer.querySelector<HTMLElement>('.card-watchlist-btn')!;
  inner.appendChild(layer);
  track.appendChild(inner);
  container.append(carouselTitle, track);
  if (carousel) root.append(container);
  else root.append(header, container);
  let frames: HTMLElement[] = [];

  const cards: CardParts[] = [];
  let items: CarouselItem[] = [];
  // Piste défilée depuis le dernier remplissage (noté au défilement, pour ne jamais relire sa position)
  let scrolled = false;
  track.addEventListener('scroll', () => { scrolled = true; }, { passive: true });
  const cardLayer: CardLayer = attachCardLayer(track, layer, (index) => items[index]);

  const indexOf = (target: EventTarget | null): number => {
    const slot = target instanceof Element ? target.closest('[data-index]') : null;
    return slot && inner.contains(slot) ? Number(slot.getAttribute('data-index')) : -1;
  };
  root.addEventListener('click', (event) => { items[indexOf(event.target)]?.onClick?.(); });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('carousel-card')) return;
    event.preventDefault();
    items[indexOf(target)]?.onClick?.();
  });
  // L'appui long est envoyé à la carte elle-même, sans remonter : écouté à la descente
  root.addEventListener('nyx:longpress', (event) => {
    const item = items[indexOf(event.target)];
    if (item && cardHasWatchlist(item)) toggleCardWatchlist(item).catch(warnOnReject('Carte TV'));
  }, true);
  // Ma liste changée (appui long ici ou ailleurs) : l'état des cartes suit, comme celui du calque
  const stopWatchlist = onWatchlistKeys(() => {
    const keys = currentWatchlistKeys();
    items.forEach((item, index) => {
      cards[index]?.card.classList.toggle('carousel-card--in-watchlist', isItemInWatchlist(item, keys));
    });
  });
  root.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('carousel-card')) return;
    const parts = cards[indexOf(target)];
    // Titre de la carte sélectionnée : il défile s'il est trop long (cardTitle.ts, tv.css)
    if (parts) markTitleOverflowSoon(target, parts.titleBox);
  });
  root.addEventListener('dragstart', (event) => event.preventDefault());
  root.addEventListener('load', (event) => {
    if (event.target instanceof HTMLImageElement && indexOf(event.target) >= 0) event.target.style.visibility = '';
  }, true);
  root.addEventListener('error', (event) => {
    const index = indexOf(event.target);
    if (!(event.target instanceof HTMLImageElement) || !cards[index]) return;
    // Affiche réduite en échec : l'adresse d'origine d'abord, le titre seulement si elle échoue aussi
    const original = fallbackPosterSrc(event.target.getAttribute('src') ?? '');
    if (original) {
      // Cachée jusqu'à l'arrivée de l'adresse d'origine (une image en échec trouvée dans le cache est déjà « complète »)
      if (bareWaitingCard) event.target.style.visibility = 'hidden';
      event.target.src = original;
    }
    else showPlaceholder(cards[index], items[index]);
  }, true);

  /** Cartes construites, jamais plus que la rangée n'en a */
  let built = 0;

  /** Remplit les cartes de `from` à `to` (exclu), en construisant celles qui manquent */
  const fillCards = (from: number, to: number) => {
    const keys = currentWatchlistKeys();
    while (cards.length < to) cards.push(buildCard(cards.length, cards.length * itemWidth, dims.cardW, dims.cardH));
    // Cartes à leur place dans la page avant d'être remplies : leur rang se lit à leur position, toutes ensemble avant
    // toute écriture (une lecture entre deux écritures forcerait une mise en page par carte). En plein mouvement, rien à
    // lire : toutes attendent la file des affiches, qui lira leur rang au moment de servir
    for (let index = from; index < to; index += 1) {
      if (cards[index].slot.parentElement !== inner) inner.insertBefore(cards[index].slot, layer);
    }
    // Seules les cartes dont l'affiche change ont un rang à lire (Suggestions est souvent relue avec les mêmes titres)
    const changes = (index: number) => {
      const image = items[index].image;
      const src = image ? tvPosterSrc(image) : null;
      return !!src && src !== cards[index].failed && cards[index].img.getAttribute('src') !== src;
    };
    const ranks = pacedPosters && !isMoving()
      ? cards.slice(from, to).map((parts, offset) => (changes(from + offset) ? posterRank(parts.card) : undefined))
      : null;
    for (let index = from; index < to; index += 1) {
      const parts = cards[index];
      fillCard(parts, items[index], keys, ranks?.[index - from]);
      fillResume(parts, items[index]);
    }
  };

  /** Rangée en chargement : titre et cartes remplacés par le décor gris, ou décor retiré */
  const showLoading = (loading: boolean) => {
    loadingTitle.hidden = !loading;
    if (loading && !loadingTitle.parentElement) container.insertBefore(loadingTitle, carouselTitle);
    // Repères du banc seulement pour une vraie rangée
    if (loading) {
      container.removeAttribute('data-testid');
      carouselTitle.removeAttribute('data-testid');
    } else {
      container.setAttribute('data-testid', 'carousel-row');
      carouselTitle.setAttribute('data-testid', 'carousel-row-title');
    }
    if (loading && frames.length === 0) {
      frames = Array.from({ length: LOADING_FRAMES }, (_, index) => {
        const frame = element('div', 'carousel-placeholder-frame');
        frame.style.cssText = `position:absolute;top:0;left:0;width:${dims.cardW}px;height:${dims.cardH}px;transform:translateX(${index * itemWidth}px)`;
        return frame;
      });
    }
    for (const frame of frames) {
      if (loading && frame.parentElement !== inner) inner.insertBefore(frame, layer);
      else if (!loading) frame.remove();
    }
  };

  // La sélection approche de la dernière carte construite : tranche suivante, à l'image suivante (hors de la tâche de
  // la flèche)
  let batchFrame = 0;
  root.addEventListener('focusin', (event) => {
    const index = indexOf(event.target);
    if (index < 0 || built >= items.length || index < built - CARD_BATCH_AHEAD || batchFrame) return;
    batchFrame = requestAnimationFrame(() => {
      batchFrame = 0;
      const next = Math.min(items.length, built + CARD_BATCH);
      fillCards(built, next);
      built = next;
    });
  });

  const fill = (data: RailRowData, fresh: boolean) => {
    // Tranche suivante demandée pour l'ancienne catégorie : la nouvelle repart de sa première tranche
    if (fresh && batchFrame) {
      cancelAnimationFrame(batchFrame);
      batchFrame = 0;
    }
    items = data.items;
    const loading = carousel && !!data.loading && items.length === 0;
    if (heading.textContent !== data.title) heading.textContent = data.title;
    if (carousel) {
      // En chargement, une espace insécable : le titre garde la hauteur de sa ligne, sans texte
      const shownTitle = loading ? '\u00a0' : data.title;
      if (carouselTitle.textContent !== shownTitle) carouselTitle.textContent = shownTitle;
      container.setAttribute('data-row-title', loading ? '' : data.title);
      showLoading(loading);
    } else container.setAttribute('data-testid', 'carousel-row');
    if (layerButton.title !== data.watchlistLabel) layerButton.title = data.watchlistLabel;
    // La rangée finit par « Voir tout » (repère du banc de test)
    root.setAttribute('data-see-all', String(items.some((item) => item.isActionButton)));
    // Rangée recyclée : elle repart d'une tranche ; même rangée relue : elle garde au moins ce qu'elle avait construit
    const wanted = Math.min(items.length, fresh ? CARD_BATCH : Math.max(built, CARD_BATCH));
    for (let index = wanted; index < cards.length; index += 1) {
      const parts = cards[index];
      parts.unsettle?.();
      parts.unsettle = null;
      parts.slot.remove();
    }
    inner.style.width = `calc(${items.length * itemWidth}px + var(--carousel-end-space, 0px))`;
    // Rangée recyclée pour une autre catégorie : elle repart de sa première carte, sans souvenir de l'ancienne. Avant le
    // remplissage : les cartes sont jugées à leur place finale (affiches seulement dans la largeur de l'écran)
    if (fresh) {
      forgetRow(track);
      if (scrolled) track.scrollLeft = 0;
      scrolled = false;
    }
    fillCards(0, wanted);
    built = wanted;
    cardLayer.refresh();
  };

  const destroy = () => {
    cancelAnimationFrame(batchFrame);
    cardLayer.detach();
    stopWatchlist();
    cards.forEach((parts) => parts.unsettle?.());
  };

  const dropImages = () => {
    for (const parts of cards) {
      parts.unsettle?.();
      parts.unsettle = null;
      // Case grise : sans adresse, l'image est cachée par tv.css
      blankPoster(parts.img);
    }
  };

  return { root, fill, dropImages, destroy };
}
