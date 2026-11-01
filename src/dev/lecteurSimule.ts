/**
 * Lecteur simulé des versions du banc de tests automatiques (VITE_BANC=1 seulement).
 *
 * Le banc ne lit jamais de vidéo : dans sa version, `services/player/mpvApi.ts` passe toutes
 * ses commandes à ce lecteur au lieu de mpv. Après le verrou du banc (adresse d'un faux fournisseur
 * seulement), « charger » une adresse ne la demande à personne : aucune requête vers un flux, même
 * factice. Le lecteur annonce une durée fixe, part de la position de départ demandée par l'app
 * (option `start`, reprise), avance hors pause et obéit aux sauts (`seek`). Comme un vrai fichier, il
 * porte une piste vidéo, deux pistes audio et une de sous-titres (PISTES_SIMULEES) : l'app y applique
 * ses choix mémorisés (vitesse, pistes) comme avec mpv. Tout le reste est le vrai code de l'app :
 * lancement depuis une fiche ou la recherche, barre de progression, sauvegarde de la position à la
 * fermeture, envoi au cloud par la synchro.
 *
 * Fidèle à mpv : il envoie ce que mpv envoie, dans le même ordre propriété par propriété, et
 * seulement quand une valeur change. Le scénario de `__tests__/traceMpv/` est joué sur le vrai mpv
 * (script de trace du banc) et sur ce lecteur, et un test compare les deux. Ce qui en découle :
 * - rien n'est envoyé pendant la commande : les événements arrivent ensuite, au fil du chargement ;
 * - un abonnement pris après coup ne reçoit, sous Windows et Linux, que les changements suivants (le
 *   module mpv observe une seule fois, au démarrage : c'est ce qui avait caché un défaut de reprise) ; sur Android, le
 *   plugin relit les valeurs courantes juste après l'abonnement, en différé (androidPlayer.ts) ;
 * - une piste audio ou de sous-titres choisie reste choisie pour les fichiers suivants (option de mpv),
 *   « auto » y compris : avant chargement et après l'arrêt, la propriété vaut l'option ;
 * - changer de piste renvoie la liste des pistes, avec la nouvelle sélection ;
 * - un saut passe par « saut en cours » vrai puis faux ;
 * - entre deux fichiers et à l'arrêt, position, durée, fin de fichier, liste des pistes et saut sont
 *   indisponibles, avec « fin de fichier » (stop) pour l'ancien flux ;
 * - la position avance par quarts de seconde, quatre fois par seconde.
 * Sur Android, les valeurs passent par le plugin natif (MpvEngine.kt) : « auto » devient false, la
 * liste des pistes n'est qu'un signal (sans la liste, relue par l'app), une propriété indisponible se
 * lit null au lieu d'une erreur, chaque lecture repart hors pause, et une propriété devenue
 * indisponible n'est transmise que pour la liste des pistes et la fin de fichier (`filename` jamais). Non
 * reproduit : le plugin limite la position à une toutes les 250 ms et peut en sauter une juste après
 * un saut ; le lecteur simulé l'envoie toujours.
 * Restent couverts par le parcours au vrai lecteur seulement (zone 6 bis) : le direct sans durée et
 * les pannes de flux.
 *
 * Dans une version normale, rien ne l'appelle et le module disparaît du bundle (vérifié par
 * le contrôle du bundle du banc) : aucun état n'est créé au chargement du module.
 */

import { isAndroid } from '../utils/platform';

/** Durée annoncée pour tout film ou épisode (10 min) : assez pour placer une reprise entre 2 et 95 %. */
export const DUREE_SIMULEE_S = 600;

/** Pas de l'horloge : mpv envoie la position plusieurs fois par seconde, en fractions. */
export const PAS_POSITION_MS = 250;

/**
 * Temps d'ouverture du fichier (début du chargement → « fichier chargé ») : le plus court possible,
 * juste après la commande. mpv ouvre une vidéo locale en ≈ 30 ms (mesuré), plus vite que l'app ne
 * monte parfois son lecteur : la durée peut alors partir avant l'abonnement (épisode suivant sans
 * durée). À 30 ms ou plus, cette course se gagnait ou se perdait selon le passage ; à 0, le banc voit
 * toujours le pire cas, que mpv peut produire.
 */
export const DELAI_CHARGEMENT_MS = 0;

/** Temps d'un saut (« saut en cours » vrai → faux). */
export const DELAI_SAUT_MS = 20;

/**
 * Pistes annoncées pour tout fichier, au format de la `track-list` de mpv : sans piste audio, l'app ne
 * restaure ni la vitesse ni les pistes mémorisées pour ce titre (usePlayerPreferences, comme avec mpv
 * sur un fichier pas encore analysé).
 */
export const PISTES_SIMULEES = [
  { id: 1, type: 'video' },
  { id: 1, type: 'audio', lang: 'fre', title: 'Français' },
  { id: 2, type: 'audio', lang: 'eng', title: 'English' },
  { id: 1, type: 'sub', lang: 'fre', title: 'Français' },
] as const;

type Ecouteur = (evenement: { name: string; data: unknown }) => void;
type EcouteurEvenement = (evenement: { event: string; [cle: string]: unknown }) => void;
/** Choix de piste de mpv : automatique, aucune, ou un numéro. */
type ChoixPiste = 'auto' | false | number;

interface Etat {
  /** Valeurs courantes ; absente ou null = indisponible, comme dans mpv. */
  proprietes: Map<string, unknown>;
  options: { aid: ChoixPiste; sid: ChoixPiste; start: number };
  ecouteurs: Set<{ noms: ReadonlySet<string>; rappel: Ecouteur }>;
  evenements: Set<EcouteurEvenement>;
  /** non : rien de chargé ; chargement : ouverture en cours ; lecture : fichier chargé. */
  phase: 'non' | 'chargement' | 'lecture';
  /** Change à chaque chargement ou arrêt : une suite d'ouverture dépassée s'arrête. */
  generation: number;
  horloge: ReturnType<typeof setInterval> | null;
  /** Saut en cours (entre « seek » et « playback-restart ») */
  saut: boolean;
  /** Numéro du dernier saut demandé : seul le dernier termine le saut, comme mpv */
  sauts: number;
  /** Envois en attente, livrés ensemble juste après la commande, dans l'ordre */
  file: Array<() => void>;
  livraison: ReturnType<typeof setTimeout> | null;
}

let etat: Etat | null = null;

/** État créé au premier appel, jamais au chargement du module (voir l'en-tête). */
function lEtat(): Etat {
  if (!etat) {
    etat = {
      proprietes: new Map<string, unknown>([
        ['pause', false], ['volume', 100], ['mute', false], ['speed', 1], ['sub-scale', 1],
        ['aid', 'auto'], ['sid', 'auto'], ['core-idle', true], ['track-list', []],
      ]),
      options: { aid: 'auto', sid: 'auto', start: 0 },
      ecouteurs: new Set(),
      evenements: new Set(),
      phase: 'non',
      generation: 0,
      horloge: null,
      saut: false,
      sauts: 0,
      file: [],
      livraison: null,
    };
  }
  return etat;
}

/** Livraison différée, comme les événements de mpv (IPC sous Windows et Linux, thread natif sur Android). */
function livrer(envoi: () => void): void {
  const e = lEtat();
  e.file.push(envoi);
  if (e.livraison) return;
  e.livraison = setTimeout(() => {
    e.livraison = null;
    const envois = e.file.splice(0);
    for (const f of envois) f();
  }, 0);
}

/** Valeur telle que l'app la reçoit (Android : conversions du plugin natif, MpvEngine.convert). */
function versApp(name: string, data: unknown): unknown {
  if (data === undefined) return null;
  if (!isAndroid()) return data;
  if (name === 'track-list') return null; // simple signal : l'app relit la liste
  if ((name === 'aid' || name === 'sid') && typeof data !== 'number') return false;
  return data;
}

function memes(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return JSON.stringify(a) === JSON.stringify(b);
  return (a === undefined || a === null) && (b === undefined || b === null);
}

/**
 * Android : le plugin natif ne transmet pas `filename` (absent de MpvEngine.OBSERVED) et, d'une
 * propriété devenue indisponible, seulement `track-list` et `eof-reached` (MpvEngine.eventProperty) :
 * l'app garde sinon l'ancienne durée et l'ancienne position jusqu'aux nouvelles valeurs.
 */
function transmisParAndroid(name: string, data: unknown): boolean {
  if (name === 'filename') return false;
  return (data !== undefined && data !== null) || name === 'track-list' || name === 'eof-reached';
}

/** Nouvelle valeur ; les abonnés n'en sont prévenus que si elle change, comme avec mpv. */
function emettre(name: string, data: unknown): void {
  const e = lEtat();
  if (memes(e.proprietes.get(name), data)) return;
  if (data === undefined || data === null) e.proprietes.delete(name);
  else e.proprietes.set(name, data);
  if (isAndroid() && !transmisParAndroid(name, data)) return;
  const pourApp = versApp(name, data);
  livrer(() => {
    for (const { noms, rappel } of e.ecouteurs) if (noms.has(name)) rappel({ name, data: pourApp });
  });
}

function annoncer(event: string, details: Record<string, unknown> = {}): void {
  const e = lEtat();
  livrer(() => {
    for (const rappel of e.evenements) rappel({ event, ...details });
  });
}

function position(): number {
  const p = lEtat().proprietes.get('time-pos');
  return typeof p === 'number' ? p : 0;
}

/** Inactif : rien de chargé, chargement en cours, pause, saut ou fin atteinte (`core-idle` de mpv). */
function majInactif(): void {
  const e = lEtat();
  const p = e.proprietes;
  emettre('core-idle', e.phase !== 'lecture' || e.saut || p.get('pause') === true || p.get('eof-reached') === true);
}

/** Piste choisie une fois le fichier chargé : « auto » prend la première piste audio, sans sous-titres. */
function pisteEffective(type: 'aid' | 'sid'): ChoixPiste {
  const choix = lEtat().options[type];
  if (choix !== 'auto') return choix;
  return type === 'aid' ? 1 : false;
}

function listeDesPistes(selection: boolean): unknown[] {
  const aid = pisteEffective('aid');
  const sid = pisteEffective('sid');
  return PISTES_SIMULEES.map((p) => ({
    ...p,
    selected: selection && (p.type === 'video' || (p.type === 'audio' && p.id === aid) || (p.type === 'sub' && p.id === sid)),
  }));
}

/** Position `p`, bornée à la durée ; la fin atteinte met en pause, comme mpv (`keep-open`). */
function placer(p: number): void {
  const e = lEtat();
  const fin = Math.max(0, Math.min(DUREE_SIMULEE_S, Math.round(p * 1000) / 1000));
  emettre('time-pos', fin);
  if (fin >= DUREE_SIMULEE_S && e.proprietes.get('eof-reached') !== true) {
    emettre('eof-reached', true);
    majInactif();
    emettre('pause', true);
  } else if (fin < DUREE_SIMULEE_S && e.proprietes.get('eof-reached') === true) {
    emettre('eof-reached', false);
    majInactif();
  }
}

function arreterHorloge(): void {
  const e = lEtat();
  if (e.horloge) clearInterval(e.horloge);
  e.horloge = null;
}

/**
 * Fichier en cours fermé (arrêt, ou fichier suivant) : « fin de fichier » (stop), puis tout ce qui
 * dépend du fichier devient indisponible ; une piste « auto » redevient « auto ».
 */
function fermer(): void {
  const e = lEtat();
  arreterHorloge();
  e.saut = false;
  if (e.phase === 'non') return;
  const ouvert = e.phase === 'lecture';
  e.phase = 'non';
  if (ouvert) {
    emettre('time-pos', null);
    annoncer('end-file', { reason: 'stop' });
  }
  emettre('duration', null);
  emettre('seeking', null);
  emettre('paused-for-cache', null);
  emettre('eof-reached', null);
  emettre('aid', e.options.aid);
  emettre('sid', e.options.sid);
  emettre('track-list', []);
}

function demarrerHorloge(): void {
  const e = lEtat();
  arreterHorloge();
  e.horloge = setInterval(() => {
    const p = e.proprietes;
    if (e.phase !== 'lecture' || e.saut || p.get('pause') === true || p.get('eof-reached') === true) return;
    const vitesse = Number(p.get('speed')) || 1;
    placer(position() + vitesse * (PAS_POSITION_MS / 1000));
  }, PAS_POSITION_MS);
}

function charger(): void {
  const e = lEtat();
  fermer();
  const generation = ++e.generation;
  // Android : chaque lecture repart hors pause (MpvEngine.load)
  if (isAndroid()) emettre('pause', false);
  e.phase = 'chargement';
  console.info('[BANC] lecteur simulé : lecture sans vidéo');
  annoncer('start-file');
  emettre('filename', `banc-${generation}`);
  emettre('track-list', listeDesPistes(false));
  setTimeout(() => {
    if (generation !== e.generation) return;
    e.phase = 'lecture';
    const start = e.options.start;
    annoncer('file-loaded');
    if (start > 0) annoncer('seek');
    emettre('duration', DUREE_SIMULEE_S);
    e.saut = true;
    emettre('seeking', true);
    emettre('paused-for-cache', false);
    emettre('eof-reached', false);
    emettre('aid', pisteEffective('aid'));
    emettre('sid', pisteEffective('sid'));
    emettre('track-list', listeDesPistes(true));
    placer(start);
    setTimeout(() => {
      if (generation !== e.generation) return;
      e.saut = false;
      annoncer('playback-restart');
      emettre('seeking', false);
      majInactif();
      demarrerHorloge();
    }, DELAI_SAUT_MS);
  }, DELAI_CHARGEMENT_MS);
}

function arreter(): void {
  const e = lEtat();
  e.generation++;
  const ouvert = e.phase !== 'non';
  fermer();
  emettre('filename', null);
  if (ouvert) annoncer('idle');
  majInactif();
}

function sauter(cible: number): void {
  const e = lEtat();
  const generation = e.generation;
  const numero = ++e.sauts;
  annoncer('seek');
  e.saut = true;
  emettre('seeking', true);
  majInactif();
  placer(cible);
  setTimeout(() => {
    if (generation !== e.generation || numero !== e.sauts || e.phase !== 'lecture') return;
    e.saut = false;
    annoncer('playback-restart');
    emettre('seeking', false);
    majInactif();
  }, DELAI_SAUT_MS);
}

/** `aid`/`sid` écrits par l'app : numéro, « auto », ou aucune piste (0, « no », false). */
function choixPiste(value: unknown): ChoixPiste {
  if (value === 'auto') return 'auto';
  if (value === false || value === 'no') return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : false;
}

/** Commande du lecteur ; l'adresse de `loadfile` a déjà passé le verrou du banc (mpvApi). */
export function commande(name: string, args: unknown[] = []): Promise<unknown> {
  switch (name) {
    case 'loadfile':
      charger();
      break;
    case 'stop':
      arreter();
      break;
    case 'seek': {
      // mpv refuse un saut sans fichier (trace) ; pendant l'ouverture, rien n'est encore à sauter
      if (lEtat().phase === 'non' && !isAndroid()) return Promise.reject(new Error('error running command'));
      if (lEtat().phase !== 'lecture') break;
      const valeur = Number(args[0]);
      if (!Number.isFinite(valeur)) return Promise.reject(new Error('seek : position invalide'));
      const mode = String(args[1] ?? 'relative');
      if (mode === 'absolute') sauter(valeur);
      else if (mode === 'absolute-percent') sauter((valeur / 100) * DUREE_SIMULEE_S);
      else sauter(position() + valeur);
      break;
    }
    case 'cycle':
      if (args[0] === 'pause') return ecrire('pause', lEtat().proprietes.get('pause') !== true).then(() => null);
      break;
    default:
      break;
  }
  return Promise.resolve(null);
}

export function ecrire(name: string, value: unknown): Promise<void> {
  const e = lEtat();
  switch (name) {
    case 'aid':
    case 'sid': {
      e.options[name] = choixPiste(value);
      if (e.phase === 'lecture') {
        emettre(name, pisteEffective(name));
        emettre('track-list', listeDesPistes(true));
      } else {
        emettre(name, e.options[name]);
      }
      break;
    }
    case 'start': {
      // Option de mpv gardée pour les fichiers suivants ; « none » ou invalide : depuis le début
      const s = Number(value);
      e.options.start = Number.isFinite(s) && s > 0 ? s : 0;
      break;
    }
    case 'pause':
      emettre('pause', value === true);
      majInactif();
      break;
    default:
      emettre(name, value);
  }
  return Promise.resolve();
}

export function lire(name: string): Promise<unknown> {
  const e = lEtat();
  if (name === 'start') return Promise.resolve(e.options.start > 0 ? String(e.options.start) : 'none');
  const valeur = e.proprietes.get(name);
  if (valeur === undefined || valeur === null) {
    // Android : le plugin rend null (androidPlayer.getProperty) ; mpv refuse une propriété indisponible
    if (isAndroid()) return Promise.resolve(null);
    return Promise.reject(new Error(`property unavailable: ${name}`));
  }
  return Promise.resolve(versApp(name, valeur) ?? valeur);
}

/**
 * Abonnement aux propriétés. Windows et Linux : seulement les changements à venir (le module mpv
 * observe au démarrage, un écouteur branché ensuite ne reçoit pas la valeur courante). Android : les
 * valeurs courantes relues juste après, en différé, puis les changements (androidPlayer.ts).
 */
export function observer(noms: ReadonlyArray<string>, rappel: Ecouteur): Promise<() => void> {
  const e = lEtat();
  const abonne = { noms: new Set(noms), rappel };
  e.ecouteurs.add(abonne);
  if (isAndroid()) {
    setTimeout(() => {
      if (!e.ecouteurs.has(abonne)) return;
      for (const name of noms) {
        const valeur = e.proprietes.get(name);
        if (valeur !== undefined && valeur !== null) rappel({ name, data: name === 'track-list' ? valeur : versApp(name, valeur) });
      }
    }, 0);
  }
  return Promise.resolve(() => { e.ecouteurs.delete(abonne); });
}

export function ecouterEvenements(rappel: EcouteurEvenement): Promise<() => void> {
  const e = lEtat();
  e.evenements.add(rappel);
  return Promise.resolve(() => { e.evenements.delete(rappel); });
}
