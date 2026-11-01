import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getPlatform } from '../../utils/platform';

/**
 * Affiches des cartes de l'accueil TV : les affiches TMDB sont demandées en 185 px de large au lieu de 342. Sur la
 * télé, une affiche 342 px décodée pèse environ 0,67 Mo contre 0,2 Mo en 185 px, et ce décodage tombe pendant le
 * défilement ; à la taille d'une carte de télé, la différence de netteté ne se voit pas (jugé à l'œil sur une vraie
 * télé). Les affiches du fournisseur, souvent bien plus grandes (667 px de large et plus), passent par l'appli native
 * (poster_thumbs.rs) : réduites une fois hors de l'écran, gardées sur le disque, montrées une fois prêtes. Sur une
 * Chromecast, les plus longs blocages de l'accueil Séries sont passés d'environ 1,2 s à 0,35 s au plus.
 */
const TMDB_SIZED = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+\//;
const TMDB = /^https:\/\/image\.tmdb\.org\//;

export const TV_POSTER_WIDTH = 185;

let shrinkProviderPosters = true;

/** Adresses d'origine dont l'affiche réduite est sur le disque */
const ready = new Set<string>();
/** Affiches que l'appli native n'a pas su réduire : demandées telles quelles jusqu'au prochain lancement */
const failed = new Set<string>();
/** Affiches demandées pour des cartes à l'écran, pas encore prêtes */
const pending = new Set<string>();
/**
 * Affiches passées à l'original parce qu'elles tardaient, avec l'heure de l'abandon : reprises en petit si elles
 * finissent par arriver, et redemandées à un remplissage plus tardif de leur carte (l'appli native a pu les jeter de
 * sa file)
 */
const late = new Map<string, number>();
/**
 * Le remplissage que l'abandon déclenche lui-même (carte réveillée aussitôt) ne redemande pas : la demande repasserait
 * en tête de la file pleine, en ferait jeter une autre, et les cartes déjà servies passeraient devant les cases grises
 */
const RETRY_AFTER_MS = 2_000;
/** Affiches en retard redemandées, sans réponse encore : une seule nouvelle demande à la fois */
const retrying = new Set<string>();
const waiters = new Map<string, Set<() => void>>();
/** Délai de chaque affiche en attente : annulé quand elle arrive ou quand les affiches sont effacées */
const limits = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * Une affiche à l'écran qui tarde (file d'attente longue, réseau lent) finit par être demandée telle quelle : une
 * carte ne reste jamais vide
 */
const PENDING_LIMIT_MS = 12_000;

interface Prepared {
  ready: string[];
  failed: string[];
  /** Jetées de la file des cartes à l'écran, trop longue (longue descente) : pas préparées, à redemander */
  dropped?: string[];
}

/** Version de mesure : affiches du fournisseur demandées telles quelles (comparaison avant / après) */
export function setShrinkProviderPosters(on: boolean): void {
  shrinkProviderPosters = on;
}

/**
 * Adresse du protocole des affiches réduites : `<http ou https>://<nom>.localhost` sous Windows et Android (même
 * forme que la page elle-même), `<nom>://localhost` ailleurs
 */
function shrunkBase(): string {
  const platform = getPlatform();
  if (platform !== 'windows' && platform !== 'android') return 'nyxposter://localhost';
  const secure = typeof location !== 'undefined' && location.protocol === 'https:';
  return `${secure ? 'https' : 'http'}://nyxposter.localhost`;
}

function shrinkable(url: string): boolean {
  return shrinkProviderPosters && !TMDB.test(url) && /^https?:\/\//i.test(url) && isTauri();
}

function stopLimit(url: string): void {
  const timer = limits.get(url);
  if (timer === undefined) return;
  clearTimeout(timer);
  limits.delete(url);
}

function settle(url: string, ok: boolean): void {
  stopLimit(url);
  const retried = retrying.delete(url);
  if (ok && late.delete(url)) failed.delete(url);
  // Une redemande qui échoue pour de bon : l'original reste, plus de redemande jusqu'au prochain lancement
  else if (!ok && retried) late.delete(url);
  if (failed.has(url)) return;
  if (ok) ready.add(url);
  else failed.add(url);
  pending.delete(url);
  const callbacks = waiters.get(url);
  waiters.delete(url);
  callbacks?.forEach((callback) => callback());
}

function settleAll(result: Prepared): void {
  result.ready.forEach((url) => settle(url, true));
  result.failed.forEach((url) => settle(url, false));
  // Jetée : sa carte prend l'original tout de suite plutôt qu'au bout du délai, et la redemande à son prochain
  // remplissage
  result.dropped?.forEach((url) => {
    retrying.delete(url);
    if (pending.has(url)) giveUp(url);
    // Redemande jetée à son tour : le délai avant la suivante repart de zéro
    else if (late.has(url)) late.set(url, Date.now());
  });
}

/** Une affiche à l'écran qui n'arrivera pas à temps : la carte prend l'original, l'affiche réduite reste attendue */
function giveUp(url: string): void {
  settle(url, false);
  late.set(url, Date.now());
}

let listening: Promise<unknown> | null = null;
/** Évènements de l'appli native, écoutés avant la première demande (aucune affiche prête ne passe inaperçue) */
function listenOnce(): Promise<unknown> {
  listening ??= Promise.all([
    listen<{ u: string }>('poster-ready', (event) => settle(event.payload.u, true)),
    listen<{ u: string }>('poster-failed', (event) => settle(event.payload.u, false)),
  ]).catch(() => undefined);
  return listening;
}

function prepare(urls: string[], urgent: boolean): Promise<void> {
  return listenOnce()
    .then(() => invoke<Prepared>('poster_prepare', { urls, width: TV_POSTER_WIDTH, urgent }))
    .then(settleAll, () => {
      // Appli native indisponible : les cartes en attente prennent l'adresse d'origine
      urls.forEach((url) => {
        if (urgent || pending.has(url)) settle(url, false);
      });
    });
}

let urgentBatch: string[] = [];
function askUrgently(url: string): void {
  pending.add(url);
  stopLimit(url);
  limits.set(url, setTimeout(() => {
    limits.delete(url);
    if (pending.has(url)) giveUp(url);
  }, PENDING_LIMIT_MS));
  sendUrgently(url);
}

/** Toutes les cartes d'une rangée remplie d'un coup : une seule demande */
function sendUrgently(url: string): void {
  if (urgentBatch.push(url) > 1) return;
  queueMicrotask(() => {
    const urls = urgentBatch;
    urgentBatch = [];
    void prepare(urls, true);
  });
}

/**
 * Adresse de l'affiche d'une carte TV. `null` : affiche du fournisseur en cours de réduction, la carte reste vide et
 * se remplit à l'appel de `onPosterSettled`. Une affiche pas encore demandée l'est alors, avant celles d'avance.
 */
export function tvPosterSrc(url: string): string | null {
  if (TMDB.test(url)) return url.replace(TMDB_SIZED, `$1w${TV_POSTER_WIDTH}/`);
  if (!shrinkable(url)) return url;
  if (failed.has(url)) {
    // En retard (peut-être jetée de la file) : la carte garde l'original, l'affiche réduite est redemandée
    const since = late.get(url);
    if (since !== undefined && Date.now() - since >= RETRY_AFTER_MS && !retrying.has(url)) {
      retrying.add(url);
      sendUrgently(url);
    }
    return url;
  }
  if (ready.has(url)) return `${shrunkBase()}/${TV_POSTER_WIDTH}?u=${encodeURIComponent(url)}`;
  if (!pending.has(url)) askUrgently(url);
  return null;
}

/** Rappel unique quand l'affiche est prête ou demandée telle quelle ; renvoie l'annulation */
export function onPosterSettled(url: string, callback: () => void): () => void {
  if (ready.has(url) || failed.has(url) || !shrinkable(url)) {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) callback();
    });
    return () => {
      cancelled = true;
    };
  }
  let callbacks = waiters.get(url);
  if (!callbacks) waiters.set(url, (callbacks = new Set()));
  callbacks.add(callback);
  return () => {
    callbacks.delete(callback);
  };
}

/**
 * Affiche réduite en échec (fichier disparu, format inconnu) : l'adresse d'origine, sinon null. L'affiche n'est plus
 * envoyée à l'appli native jusqu'au prochain lancement.
 */
export function fallbackPosterSrc(src: string): string | null {
  const base = shrunkBase();
  if (!src.startsWith(`${base}/`)) return null;
  const original = new URL(src.replace(base, 'http://x')).searchParams.get('u');
  if (original) {
    ready.delete(original);
    failed.add(original);
  }
  return original;
}

/** Affiches réduites effacées du disque (mesure d'une première ouverture) */
export function clearShrunkPosters(): Promise<void> {
  ready.clear();
  failed.clear();
  pending.clear();
  late.clear();
  retrying.clear();
  limits.forEach((timer) => clearTimeout(timer));
  limits.clear();
  return invoke('poster_cache_clear');
}

/**
 * Affiches du fournisseur réduites d'avance par l'appli native (rien sans le réglage) : à la toute première ouverture,
 * les rangées suivantes sont prêtes quand on y descend. Dans l'ordre donné ; chaque nouvelle liste remplace la
 * précédente (autre onglet, accueil rouvert), les affiches des cartes à l'écran passent toujours avant.
 */
export function prefetchShrunkPosters(urls: readonly string[]): void {
  if (!shrinkProviderPosters || !isTauri()) return;
  const wanted = [...new Set(urls)].filter((url) => url && shrinkable(url) && !ready.has(url) && !failed.has(url));
  void prepare(wanted, false);
}
