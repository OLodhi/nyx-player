/**
 * androidPlayer.ts — Implémentation Android de l'API lecteur (plugin natif `nyx-android`).
 *
 * Le plugin Kotlin pilote libmpv (même moteur que le lecteur desktop) dans une vue placée
 * SOUS la WebView. Il expose les propriétés mpv (`time-pos`, `paused-for-cache`,
 * `track-list`…), ce module traduit donc seulement les commandes et setters mpv
 * utilisés par l'app vers les commandes du plugin.
 */

import { invoke, addPluginListener } from '@tauri-apps/api/core';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { devLog } from '../../utils/devLog';
import { classifyNativeError, emitPlaybackError } from './playbackErrors';
import { createLogger } from '../../utils/logger';

const log = createLogger('AndroidPlayer');

const PLUGIN = 'nyx-android';

interface PropertyEvent {
  name: string;
  data: unknown;
}

const call = <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> =>
  invoke<T>(`plugin:${PLUGIN}|${cmd}`, args);

// L'app pilote panscan + video-aspect-override ; le plugin expose un "resize mode" fit/fill/stretch.
let panscan = 0;
let aspectOverride = '-1';
/** Option mpv `start` (secondes) : position d'ouverture du prochain flux, comme sous Windows */
let nextStartSeconds = 0;

const applyResizeMode = () => {
  const mode = aspectOverride !== '-1' ? 'stretch' : panscan > 0 ? 'fill' : 'fit';
  return call('set_resize_mode', { mode });
};

/** Attachement de l'écouteur d'erreurs, partagé par les appels simultanés ; remis à null s'il échoue */
let errorListener: Promise<unknown> | null = null;

/**
 * Le plugin natif survit à un rechargement de la WebView (crash du renderer, reload dev) :
 * aucune lecture n'appartient au nouveau contexte JS, on arrête donc le lecteur
 * (stop() natif sort aussi du plein écran / paysage forcé).
 */
export function resetOnStartup(): void {
  call('stop').catch(() => {});
}

interface NativeErrorPayload {
  code?: string;
  httpStatus?: number;
  detail?: string;
  engine?: string;
  continuable?: boolean;
  known?: boolean;
}

export async function init(): Promise<string> {
  if (!errorListener) {
    errorListener = addPluginListener(PLUGIN, 'error', (payload: NativeErrorPayload) => {
      log.error('Playback error:', payload.engine, payload.code, payload.httpStatus ?? '');
      emitPlaybackError({
        kind: classifyNativeError(payload.code, payload.httpStatus),
        httpStatus: payload.httpStatus || undefined,
        detail: payload.detail || undefined,
        engine: payload.engine,
        continuable: payload.continuable || undefined,
        known: payload.known || undefined,
      });
    }).catch((error: unknown) => {
      // Sans écouteur, plus aucune erreur de lecture ne s'afficherait : réessayé au lancement suivant
      errorListener = null;
      throw error;
    });
  }
  await errorListener;
  return 'main';
}

export async function command(name: string, args: unknown[] = []): Promise<unknown> {
  switch (name) {
    case 'loadfile':
      panscan = 0;
      aspectOverride = '-1';
      return call('play', { url: String(args[0]), start: nextStartSeconds });
    case 'stop':
      return call('stop');
    case 'seek': {
      const [value, mode] = args;
      // mpv : mode par défaut = relatif
      return call('seek', { position: Number(value), relative: mode !== 'absolute' });
    }
    case 'cycle':
      if (args[0] === 'pause') {
        const paused = await getProperty('pause');
        return call('set_paused', { paused: !paused });
      }
      break;
  }
  devLog('player', `[AndroidPlayer] mpv command ignorée : ${name}`);
  return undefined;
}

/** Valeurs mpv de aid/sid → id du plugin : -1 = choix automatique, 0 = aucune piste */
function trackId(value: unknown): number {
  if (value === 'auto') return -1;
  if (value === false || value === 'no') return 0;
  return Number(value);
}

export async function setProperty(name: string, value: unknown): Promise<void> {
  switch (name) {
    case 'pause':
      await call('set_paused', { paused: Boolean(value) });
      return;
    case 'volume':
      await call('set_volume', { volume: Number(value) });
      return;
    case 'mute':
      await call('set_muted', { muted: Boolean(value) });
      return;
    case 'speed':
      await call('set_speed', { speed: Number(value) });
      return;
    case 'aid':
      await call('select_track', { type: 'audio', id: trackId(value) });
      return;
    case 'sid':
      await call('select_track', { type: 'sub', id: trackId(value) });
      return;
    case 'sub-scale':
      await call('set_subtitle_scale', { scale: Number(value) });
      return;
    case 'panscan':
      panscan = Number(value) || 0;
      await applyResizeMode();
      return;
    case 'start': {
      // « none » ou valeur invalide : le flux suivant s'ouvre au début
      const seconds = Number(value);
      nextStartSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
      return;
    }
    case 'video-aspect-override':
      aspectOverride = String(value) === '-1' ? '-1' : String(value);
      await applyResizeMode();
      return;
  }
  devLog('player', `[AndroidPlayer] propriété mpv ignorée : ${name}`);
}

export async function getProperty(name: string): Promise<unknown> {
  const result = await call<{ value: unknown }>('get_property', { name });
  return result?.value ?? null;
}

/** Même contrat que mpv observe_property : valeur courante immédiate puis changements. */
export async function observeProperties(
  properties: ReadonlyArray<string>,
  callback: (event: PropertyEvent) => void,
): Promise<UnlistenFn> {
  const wanted = new Set(properties);
  const listener = await addPluginListener(PLUGIN, 'property', (payload: PropertyEvent) => {
    if (wanted.has(payload.name)) callback(payload);
  });

  await Promise.all(
    properties.map(async (name) => {
      const data = await getProperty(name).catch(() => null);
      if (data !== null) callback({ name, data });
    }),
  );

  return () => {
    void listener.unregister();
  };
}

export type MediaCommand = 'next' | 'previous';

/**
 * Commandes de la MediaSession que seule l'interface sait traiter : chaîne suivante / précédente
 * en direct (Assistant, touches « piste suivante / précédente » d'un casque ou d'une télécommande).
 * Lecture, pause et déplacements sont appliqués par le plugin lui-même.
 */
export async function listenMediaCommands(callback: (command: MediaCommand) => void): Promise<UnlistenFn> {
  const listener = await addPluginListener(PLUGIN, 'mediaCommand', (payload: { action?: string }) => {
    if (payload.action === 'next' || payload.action === 'previous') callback(payload.action);
  });
  return () => {
    void listener.unregister();
  };
}

export function setVideoMarginRatio(ratio: { left?: number; right?: number; top?: number; bottom?: number }): Promise<void> {
  return call('set_video_margins', {
    left: ratio.left ?? 0,
    right: ratio.right ?? 0,
    top: ratio.top ?? 0,
    bottom: ratio.bottom ?? 0,
  });
}

export function setFullscreen(enabled: boolean): Promise<void> {
  return call('set_fullscreen', { enabled });
}
