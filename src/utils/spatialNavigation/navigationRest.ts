/**
 * Retraits remis au repos de la télécommande.
 *
 * Sur une petite télé (Chromecast, 2 Go), retirer du DOM une rangée ou une carte qui vient de sortir de l'écran
 * coûte cher (jusqu'à près de 2 s cumulées pendant une descente rapide) : fait dans la tâche de la flèche, ce
 * démontage retardait l'image suivante. Les éléments sortis restent donc en place, invisibles à l'écran, tant que
 * des flèches arrivent ; une fois qu'aucune flèche n'est arrivée depuis REST_DELAY_MS, ils sont retirés.
 *
 * Par petites tâches : un seul retrait par tâche (une rangée coûte environ 150 ms), puis le suivant RELEASE_STEP_MS
 * plus tard, tant que le repos dure. Tout retirer d'un bloc pouvait figer la télé près d'une seconde, juste au moment
 * où l'on reprend les flèches. Une flèche suspend aussitôt la suite : le reste attend le prochain repos.
 *
 * Un seul minuteur pour toute l'application, et seulement tant qu'un retrait attend.
 *
 * Même principe pour les affiches de l'accueil TV (`whenStill`) : une affiche posée en plein mouvement coûte des images
 * au défilement. Pendant le mouvement, seules quelques-unes passent à chaque image (la rangée sélectionnée, puis les
 * cartes à l'écran) ; les autres attendent l'arrêt de la sélection, puis arrivent quelques-unes par image, les plus
 * utiles d'abord. Sur une Chromecast, ce partage a fait disparaître les saccades de la descente tout en laissant à peine
 * une ou deux cases grises à l'écran.
 */

/** Repos de la navigation : aucune flèche depuis ce délai. */
export const REST_DELAY_MS = 600;
/** Écart entre deux retraits successifs pendant le repos, pour laisser passer une flèche entre deux. */
export const RELEASE_STEP_MS = 50;

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Retraits en attente, dans l'ordre des demandes. */
const pending = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let lastArrowAt = Number.NEGATIVE_INFINITY;

/** Programme le prochain retrait : au repos, et jamais dans la tâche en cours. */
function arm(): void {
  if (timer !== null) clearTimeout(timer);
  const sinceArrow = Date.now() - lastArrowAt;
  timer = setTimeout(releaseOne, Math.max(RELEASE_STEP_MS, REST_DELAY_MS - sinceArrow));
}

function releaseOne(): void {
  timer = null;
  const first = pending.values().next();
  if (first.done) return;
  pending.delete(first.value);
  // Le suivant est programmé avant d'appeler le retrait : une demande faite pendant celui-ci ne relance rien
  if (pending.size > 0) arm();
  first.value();
}

function onKeyDown(event: KeyboardEvent): void {
  if (ARROW_KEYS.has(event.key)) noteArrow();
}

/** Un déplacement vient d'avoir lieu sans flèche (appui gardé rejoué, arrowKeys.ts) : le repos est repoussé. */
export function noteArrow(): void {
  lastArrowAt = Date.now();
  if (timer !== null) arm();
  if (stillTimer !== null) armStill();
  // Des demandes restées en attente (NOT_YET : carte loin à droite) sont relues pendant ce mouvement et au prochain arrêt
  if (stillWaiters.size > 0) {
    if (stillTimer === null && !trickling) armStill();
    startDrip();
  }
}

/** Arrêt de la sélection pour `whenStill` : plus court que le repos des retraits, l'affiche attend moins. */
export const STILL_DELAY_MS = 300;
/** Demandes servies par image à l'arrêt, les plus prioritaires d'abord */
export const STILL_PER_FRAME = 2;
/** Demandes servies par image pendant le mouvement */
export const MOVING_PER_FRAME = 2;
/** Pendant le mouvement, seules les demandes de priorité 0 (rangée sélectionnée) et 1 (à l'écran) passent */
const MOVING_MAX_RANK = 1;
/**
 * Priorité d'une demande qui ne doit pas encore être servie (carte au-delà du bord droit de l'écran) : elle reste en
 * attente, relue au prochain mouvement et au prochain arrêt, sans entretenir de boucle d'images.
 */
export const NOT_YET = Number.POSITIVE_INFINITY;

/** Une demande en attente de l'arrêt, avec sa priorité lue au moment de servir (plus petit d'abord) */
interface StillWaiter {
  run: () => void;
  priority?: () => number;
}
const stillWaiters = new Set<StillWaiter>();
let stillTimer: ReturnType<typeof setTimeout> | null = null;
/** Une image est demandée pour servir la suite, à l'arrêt (`trickle`) ou en mouvement (`drip`) */
let trickling = false;
let dripping = false;
let servingWhileMoving = false;

/** Une flèche est arrivée il y a moins de STILL_DELAY_MS : la sélection bouge encore. */
export function isMoving(): boolean {
  return Date.now() - lastArrowAt < STILL_DELAY_MS;
}

/** Vrai pendant qu'une demande est servie en plein mouvement : elle ne doit pas se remettre à attendre l'arrêt. */
export function isServingWhileMoving(): boolean {
  return servingWhileMoving;
}

function armStill(): void {
  if (stillTimer !== null) clearTimeout(stillTimer);
  stillTimer = setTimeout(onStill, Math.max(0, STILL_DELAY_MS - (Date.now() - lastArrowAt)));
}

function onStill(): void {
  stillTimer = null;
  if (isMoving()) {
    armStill();
    return;
  }
  if (!trickling) trickle();
}

/** Demandes à servir rangées par priorité (plus petit d'abord), lue au moment de servir ; NOT_YET restent en attente */
function byPriority(maxRank = Number.POSITIVE_INFINITY): StillWaiter[] {
  return [...stillWaiters]
    .map((waiter) => ({ waiter, rank: waiter.priority?.() ?? 0 }))
    .filter(({ rank }) => rank !== NOT_YET && rank <= maxRank)
    .sort((a, b) => a.rank - b.rank)
    .map(({ waiter }) => waiter);
}

/** À l'arrêt : quelques demandes par image ; une flèche suspend la suite, qui attend le prochain arrêt. */
function trickle(): void {
  trickling = false;
  if (stillWaiters.size === 0) return;
  if (isMoving()) {
    if (stillTimer === null) armStill();
    return;
  }
  const order = byPriority();
  let served = 0;
  try {
    for (const waiter of order.slice(0, STILL_PER_FRAME)) {
      stillWaiters.delete(waiter);
      served += 1;
      waiter.run();
    }
  } finally {
    // Même si une demande a échoué (la suite de son image comprise) : les suivantes ne restent pas en attente. Celles
    // qui ne sont pas encore à servir n'entretiennent pas la boucle : une flèche les relira
    if (order.length > served) {
      trickling = true;
      requestAnimationFrame(trickle);
    }
  }
}

/**
 * Pendant le mouvement : quelques demandes par image, seulement la rangée sélectionnée et les cartes à l'écran. S'arrête
 * dès que la sélection ne bouge plus (l'arrêt prend le relais) ou qu'il n'y a plus rien en attente.
 */
function drip(): void {
  dripping = false;
  if (stillWaiters.size === 0 || !isMoving()) return;
  try {
    for (const waiter of byPriority(MOVING_MAX_RANK).slice(0, MOVING_PER_FRAME)) {
      stillWaiters.delete(waiter);
      servingWhileMoving = true;
      try {
        waiter.run();
      } finally {
        servingWhileMoving = false;
      }
    }
  } finally {
    // Une image de plus même sans candidat : une carte en attente peut entrer à l'écran pendant le mouvement
    if (stillWaiters.size > 0) startDrip();
  }
}

function startDrip(): void {
  if (dripping) return;
  dripping = true;
  requestAnimationFrame(drip);
}

/**
 * Appelle `run` quand son tour vient : en plein mouvement si sa priorité le permet (0 rangée sélectionnée, 1 à
 * l'écran), sinon à l'arrêt de la sélection (aucune flèche depuis STILL_DELAY_MS), jamais dans la tâche en cours.
 * `priority` est lue au moment de servir (plus petit d'abord ; 0 sans elle). Renvoie l'annulation.
 */
export function whenStill(run: () => void, priority?: () => number): () => void {
  const entry: StillWaiter = { run, priority };
  stillWaiters.add(entry);
  if (stillTimer === null && !trickling) armStill();
  if (isMoving()) startDrip();
  return () => {
    stillWaiters.delete(entry);
  };
}

// Une seule écoute des flèches pour toute l'application, posée au chargement (le premier retrait doit déjà connaître
// l'heure de la flèche qui l'a provoqué) ; elle ne fait que noter cette heure, en phase de capture pour passer avant
// la navigation, qui peut arrêter la propagation
if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown, true);

/**
 * Demande que `release` soit appelée au repos de la navigation, jamais dans la tâche courante. Un retrait par tâche :
 * `release` ne doit retirer qu'une petite part (une rangée, quelques cartes) et redemander pour le reste. Renvoie
 * l'annulation (à appeler au démontage, ou quand le retrait n'a plus lieu d'être) ; sans effet s'il a déjà eu lieu.
 */
export function releaseAtRest(release: () => void): () => void {
  // Une entrée propre à cet appel : la même fonction demandée deux fois donne deux retraits distincts
  const entry = () => release();
  pending.add(entry);
  if (timer === null) arm();
  return () => {
    if (!pending.delete(entry)) return;
    if (pending.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
