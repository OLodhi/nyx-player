/**
 * mpvApi.ts — Point d'entrée unique du lecteur vidéo.
 *
 * Même API que `tauri-plugin-mpv-api` :
 * - Desktop : lancement et commandes via la garde Rust `nyx_mpv_init` / `nyx_mpv_command`
 *   (`src-tauri/src/mpv_guard.rs`) : chemin de mpv fixe, commandes et propriétés en liste blanche,
 *   marges vidéo via `nyx_mpv_set_margins`. Les événements restent servis par le plugin.
 * - Android et iOS : délègue au plugin natif libmpv (androidPlayer.ts, même plugin `nyx-android`).
 *
 * Tous les hooks/services lecteur importent depuis ce module, jamais directement
 * depuis `tauri-plugin-mpv-api`.
 *
 * Versions du banc de tests automatiques (VITE_BANC=1, posée avec VITE_AUDIT=1 par le banc) : verrou
 * « jamais de vrai flux ». Les versions d'audit ordinaires (VITE_AUDIT=1 seul, tests à la main) lisent
 * normalement.
 * Tout `loadfile` vers une adresse qui n'est pas celle d'un faux fournisseur local est refusé, sur
 * Windows comme sur Android et iOS. Aucun moyen de le lever. Une adresse
 * admise n'est pas lue non plus : le lecteur simulé (dev/lecteurSimule.ts) remplace mpv, sans aucune
 * requête vers le flux. Seule exception, la variante « vrai lecteur » du banc (VITE_BANC_LECTEUR=reel) :
 * le même verrou, puis mpv lit l'adresse admise (les vidéos de test du faux fournisseur local).
 * Dans une version normale, la condition vaut false à la compilation : verrou et lecteur simulé
 * disparaissent.
 */

import * as mpv from 'tauri-plugin-mpv-api';
import type { MpvEvent, MpvPropertyEventFor, MpvPropertyValue, VideoMarginRatio } from 'tauri-plugin-mpv-api';
import { invoke } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { usesNyxPlugin } from '../../utils/platform';
import * as android from './androidPlayer';
import { cancelForcedUnpause } from './forcedUnpause';
import { erreurLectureRefusee, natureAdresse, noterTentative } from '../../dev/bancAdresses';
import * as simule from '../../dev/lecteurSimule';

/** Version du banc : évalué à la compilation, comme AUDIT_BRIDGE_ENABLED (dev/auditBridge.tsx). */
const VERROU_BANC = import.meta.env.VITE_BANC === '1';
/**
 * Lecteur simulé : toute version du banc, sauf la variante « vrai lecteur » (VITE_BANC_LECTEUR=reel,
 * zone 6 bis). Celle-ci garde le verrou (seule l'adresse d'un faux fournisseur local passe) mais
 * laisse mpv (Windows) ou libmpv (Android et iOS) lire cette adresse : les vidéos de test du banc, fabriquées
 * par lui, jamais un vrai flux.
 */
const LECTEUR_SIMULE = VERROU_BANC && import.meta.env.VITE_BANC_LECTEUR !== 'reel';

/**
 * Verrou du banc : null si la lecture est permise, sinon l'erreur à rendre. L'adresse n'est jamais
 * écrite (ni console, ni erreur) : seule sa nature est notée, pour le pont d'audit.
 */
function verrouBanc(args: unknown[] | undefined): Error | null {
  const cible = natureAdresse(args?.[0]);
  noterTentative(cible, cible === 'faux', args?.[0]);
  if (cible === 'faux') return null;
  console.warn('[BANC] lecture refusée : adresse hors du faux fournisseur');
  return erreurLectureRefusee();
}

/** Lancement de mpv.exe : le chemin du programme est fixé côté Rust (ressource `mpv/mpv.exe`). */
export interface MpvConfig {
  /** Options en liste blanche côté Rust (`--vo=…`, `--hwdec=…`…) */
  args: string[];
  observedProperties: readonly string[];
  ipcTimeoutMs: number;
}

export function init(config?: MpvConfig): Promise<string> {
  if (LECTEUR_SIMULE) return Promise.resolve('banc');
  if (usesNyxPlugin()) return android.init();
  if (!config) return Promise.reject(new Error('mpv config required'));
  return invoke<string>('nyx_mpv_init', {
    args: config.args,
    observedProperties: config.observedProperties,
    ipcTimeoutMs: config.ipcTimeoutMs,
  });
}

/** Commande mpv desktop, vérifiée par la garde Rust ; renvoie la donnée de la réponse. */
function desktopCommand(name: string, args: unknown[] = []): Promise<unknown> {
  return invoke<unknown>('nyx_mpv_command', { name, args });
}

export function command(name: string, args?: unknown[]): Promise<unknown> {
  if (VERROU_BANC && (name === 'loadfile' || name === 'loadlist')) {
    // loadlist et les options de fichier de loadfile (3e argument et suivants) ne servent pas dans
    // l'app : refusés dans le banc, pour qu'un ajout futur ne passe jamais sous le verrou.
    const refus = name === 'loadlist' || (args?.length ?? 0) > 2 ? (noterTentative('autre', false), erreurLectureRefusee()) : verrouBanc(args);
    if (refus) return Promise.reject(refus);
  }
  // Pause basculée par l'utilisateur : la reprise automatique d'après chargement ne doit pas l'annuler
  if (name === 'cycle' && args?.[0] === 'pause') cancelForcedUnpause();
  if (LECTEUR_SIMULE) {
    // Android et iOS : le lancement met l'app en paysage plein écran par le plugin natif (usePlaybackSession),
    // et seul le « stop » natif l'en sort. Le lecteur simulé ne l'envoyait pas : l'app du banc restait
    // en paysage après le lecteur (téléphone réel). Sortie du plein écran seule, aucun moteur touché.
    if (name === 'stop' && usesNyxPlugin()) {
      android.setFullscreen(false).catch((e) => console.warn('[BANC] sortie du plein écran impossible :', e));
    }
    return simule.commande(name, args);
  }
  return usesNyxPlugin() ? android.command(name, args) : desktopCommand(name, args);
}

export function setProperty<T = never, K extends string = string>(
  name: K,
  value: [T] extends [never] ? MpvPropertyValue<K> : T,
): Promise<void> {
  // Banc : aucune propriété qui ouvrirait une adresse sans passer par loadfile
  if (VERROU_BANC && /^(stream-open-filename|path|playlist)/.test(name)) {
    noterTentative('autre', false);
    return Promise.reject(erreurLectureRefusee());
  }
  if (name === 'pause') cancelForcedUnpause();
  if (LECTEUR_SIMULE) return simule.ecrire(name, value);
  if (usesNyxPlugin()) return android.setProperty(name, value);
  return desktopCommand('set_property', [name, value]).then(() => undefined);
}

export function getProperty<T = never, K extends string = string>(
  name: K,
): Promise<[T] extends [never] ? MpvPropertyValue<K> : T> {
  if (LECTEUR_SIMULE) return simule.lire(name) as Promise<[T] extends [never] ? MpvPropertyValue<K> : T>;
  if (usesNyxPlugin()) {
    return android.getProperty(name) as Promise<[T] extends [never] ? MpvPropertyValue<K> : T>;
  }
  return desktopCommand('get_property', [name]) as Promise<[T] extends [never] ? MpvPropertyValue<K> : T>;
}

export function observeProperties<T extends ReadonlyArray<string>>(
  properties: T,
  callback: (event: MpvPropertyEventFor<T[number]>) => void,
): Promise<UnlistenFn> {
  if (LECTEUR_SIMULE) return simule.observer(properties, callback as (event: { name: string; data: unknown }) => void);
  if (usesNyxPlugin()) {
    return android.observeProperties(properties, callback as (event: { name: string; data: unknown }) => void);
  }
  return mpv.observeProperties(properties, callback);
}

/**
 * mpv.exe tourne-t-il encore ? (desktop : état du processus lu côté Rust, sans passer par mpv).
 * Android et iOS : libmpv vit dans le processus de l'app, un plantage emporte l'app entière ; toujours vrai.
 */
export function isEngineAlive(): Promise<boolean> {
  if (LECTEUR_SIMULE) return Promise.resolve(true);
  if (usesNyxPlugin()) return Promise.resolve(true);
  return invoke<boolean>('nyx_mpv_alive');
}

/**
 * mpv.exe peut-il vérifier un flux HTTPS ? Faux seulement si l'export des certificats du système a
 * échoué (Rust, `mpv_tls.rs`) : le flux est alors refusé par mpv. Android et iOS : libmpv signale
 * lui-même ce cas (`TLS_CA_UNAVAILABLE`) ; toujours vrai.
 */
export function isHttpsVerifiable(): Promise<boolean> {
  if (LECTEUR_SIMULE) return Promise.resolve(true);
  if (usesNyxPlugin()) return Promise.resolve(true);
  return invoke<boolean>('nyx_mpv_tls_ready');
}

/** Événements bruts mpv (desktop). Android et iOS remontent leurs erreurs via le plugin natif (androidPlayer). */
export function listenDesktopEvents(callback: (event: MpvEvent) => void): Promise<UnlistenFn> {
  if (LECTEUR_SIMULE) return usesNyxPlugin() ? Promise.resolve(() => {}) : simule.ecouterEvenements(callback as unknown as Parameters<typeof simule.ecouterEvenements>[0]);
  if (usesNyxPlugin()) return Promise.resolve(() => {});
  return mpv.listenEvents(callback);
}

/** Chaîne suivante / précédente demandée par l'Assistant ou un casque (plugin natif ; iOS n'en envoie qu'à partir de M4). */
export function listenMediaCommands(callback: (command: android.MediaCommand) => void): Promise<UnlistenFn> {
  if (!usesNyxPlugin()) return Promise.resolve(() => {});
  return android.listenMediaCommands(callback);
}

export function setVideoMarginRatio(ratio: VideoMarginRatio): Promise<void> {
  if (LECTEUR_SIMULE) return Promise.resolve();
  if (usesNyxPlugin()) return android.setVideoMarginRatio(ratio);
  return invoke<void>('nyx_mpv_set_margins', {
    left: ratio.left ?? null,
    right: ratio.right ?? null,
    top: ratio.top ?? null,
    bottom: ratio.bottom ?? null,
  });
}
