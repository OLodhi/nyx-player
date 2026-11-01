/**
 * Plugin Android : réponses d'erreur du lecteur natif.
 * - un refus du plugin remonte à l'appelant au lieu d'être avalé ;
 * - les erreurs de lecture envoyées par MpvEngine.kt arrivent classées dans playbackErrors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Listener = (payload: unknown) => void;

const { invoke, addPluginListener, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    listeners,
    invoke: vi.fn(),
    addPluginListener: vi.fn((_plugin: string, event: string, cb: (payload: unknown) => void) => {
      listeners.set(event, cb);
      return Promise.resolve({ unregister: vi.fn().mockResolvedValue(undefined) });
    }),
  };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke, addPluginListener }));

import type { PlaybackError } from '../playbackErrors';

/** Module neuf à chaque test : l'écouteur d'erreurs et le mode d'image sont des états du module */
async function load() {
  vi.resetModules();
  const player = await import('../androidPlayer');
  const errors = await import('../playbackErrors');
  const received: PlaybackError[] = [];
  errors.subscribePlaybackErrors((e) => received.push(e));
  return { player, received };
}

const refused = new Error('Player command failed');

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  addPluginListener.mockClear();
  listeners.clear();
});
afterEach(() => vi.restoreAllMocks());
const commandsSent = () => invoke.mock.calls.map(([cmd]) => String(cmd).replace('plugin:nyx-android|', ''));

describe('androidPlayer — refus du plugin', () => {
  it('chargement, arrêt et déplacement refusés remontent l\'erreur', async () => {
    const { player } = await load();
    invoke.mockRejectedValue(refused);
    await expect(player.command('loadfile', ['http://test.invalid/live/1.ts'])).rejects.toBe(refused);
    await expect(player.command('stop')).rejects.toBe(refused);
    await expect(player.command('seek', [10, 'absolute'])).rejects.toBe(refused);
  });

  it('un réglage refusé (pause, volume, piste, sous-titres, mode d\'image) remonte l\'erreur', async () => {
    const { player } = await load();
    invoke.mockRejectedValue(refused);
    for (const [name, value] of [['pause', true], ['volume', 50], ['mute', true], ['speed', 1.5], ['aid', 2], ['sid', 'no'], ['sub-scale', 1.2], ['panscan', 1], ['video-aspect-override', '16:9']] as const) {
      await expect(player.setProperty(name, value), name).rejects.toBe(refused);
    }
  });

  it('marges vidéo et plein écran refusés remontent l\'erreur', async () => {
    const { player } = await load();
    invoke.mockRejectedValue(refused);
    await expect(player.setVideoMarginRatio({ left: 0.3 })).rejects.toBe(refused);
    await expect(player.setFullscreen(true)).rejects.toBe(refused);
  });

  it('bascule de pause : si l\'état courant est illisible, rien n\'est envoyé', async () => {
    const { player } = await load();
    invoke.mockImplementation((cmd: string) => (cmd.endsWith('|get_property') ? Promise.reject(refused) : Promise.resolve(undefined)));
    await expect(player.command('cycle', ['pause'])).rejects.toBe(refused);
    expect(commandsSent()).toEqual(['get_property']);
  });

  it('lecture d\'une propriété : refus remonté, réponse vide ou sans valeur lue comme null', async () => {
    const { player } = await load();
    invoke.mockRejectedValueOnce(refused);
    await expect(player.getProperty('time-pos')).rejects.toBe(refused);
    invoke.mockResolvedValueOnce(undefined);
    await expect(player.getProperty('time-pos')).resolves.toBeNull();
    invoke.mockResolvedValueOnce(null);
    await expect(player.getProperty('time-pos')).resolves.toBeNull();
    invoke.mockResolvedValueOnce({});
    await expect(player.getProperty('time-pos')).resolves.toBeNull();
    invoke.mockResolvedValueOnce({ value: false });
    await expect(player.getProperty('pause')).resolves.toBe(false);
  });

  it('arrêt au démarrage : un refus (lecteur pas prêt) est ignoré sans erreur non rattrapée', async () => {
    const { player } = await load();
    invoke.mockRejectedValue(refused);
    expect(() => player.resetOnStartup()).not.toThrow();
    await Promise.resolve();
    expect(commandsSent()).toEqual(['stop']);
  });

  it('commande ou propriété mpv inconnue : ignorée, sans appel au plugin', async () => {
    const { player } = await load();
    await expect(player.command('screenshot')).resolves.toBeUndefined();
    await expect(player.command('cycle', ['mute'])).resolves.toBeUndefined();
    await expect(player.setProperty('hwdec', 'auto')).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('androidPlayer — observation des propriétés', () => {
  it('valeur initiale illisible : ignorée, les changements suivants arrivent quand même', async () => {
    const { player } = await load();
    invoke.mockImplementation((_cmd: string, args: { name: string }) =>
      args.name === 'pause' ? Promise.reject(refused) : Promise.resolve({ value: 12 }),
    );
    const seen: unknown[] = [];
    const unlisten = await player.observeProperties(['pause', 'time-pos'], (e) => seen.push(e));
    expect(seen).toEqual([{ name: 'time-pos', data: 12 }]);

    (listeners.get('property') as Listener)({ name: 'pause', data: true });
    (listeners.get('property') as Listener)({ name: 'volume', data: 30 }); // non demandée
    expect(seen).toEqual([{ name: 'time-pos', data: 12 }, { name: 'pause', data: true }]);
    unlisten();
  });

  it('écouteur impossible à attacher : l\'erreur remonte', async () => {
    const { player } = await load();
    addPluginListener.mockRejectedValueOnce(new Error('bridge not ready'));
    await expect(player.observeProperties(['pause'], () => {})).rejects.toThrow('bridge not ready');
  });

  it('commandes média : seules « next » et « previous » sont transmises', async () => {
    const { player } = await load();
    const seen: string[] = [];
    await player.listenMediaCommands((c) => seen.push(c));
    const emit = listeners.get('mediaCommand') as Listener;
    emit({ action: 'next' });
    emit({ action: 'play' });
    emit({});
    emit({ action: 'previous' });
    expect(seen).toEqual(['next', 'previous']);
  });
});

describe('androidPlayer — erreurs de lecture du moteur natif', () => {
  it('chaque code envoyé par MpvEngine.kt arrive classé, sans champ vide', async () => {
    const { player, received } = await load();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await player.init();
    const emit = listeners.get('error') as Listener;

    emit({ engine: 'libmpv', code: 'MPV_LOAD_FAILED' });
    emit({ engine: 'libmpv', code: 'MPV_LOAD_FAILED', httpStatus: 458 });
    emit({ engine: 'libmpv', code: 'MPV_LOAD_FAILED', httpStatus: 401 });
    emit({ engine: 'libmpv', code: 'MPV_LOAD_FAILED', httpStatus: 404 });
    emit({ engine: 'libmpv', code: 'MPV_LOAD_FAILED', httpStatus: 0 });
    emit({ engine: 'libmpv', code: 'TLS_CA_UNAVAILABLE' });
    emit({ engine: 'libmpv', code: 'NO_DECODER', detail: 'hevc' });
    emit({ engine: 'libmpv', code: 'DEVICE_TOO_SLOW', detail: 'Dolby Vision 5', continuable: true, known: true });
    emit({ engine: 'libmpv', code: 'SOMETHING_NEW', detail: '' });
    emit({});

    expect(received).toEqual([
      { kind: 'network', httpStatus: undefined, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'connection_limit', httpStatus: 458, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'access_denied', httpStatus: 401, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'not_found', httpStatus: 404, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      // Code HTTP 0 = pas de réponse : ni « code 0 » affiché, ni classement HTTP
      { kind: 'network', httpStatus: undefined, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'tls_unavailable', httpStatus: undefined, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'unsupported_format', httpStatus: undefined, detail: 'hevc', engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'device_too_slow', httpStatus: undefined, detail: 'Dolby Vision 5', engine: 'libmpv', continuable: true, known: true },
      { kind: 'unknown', httpStatus: undefined, detail: undefined, engine: 'libmpv', continuable: undefined, known: undefined },
      { kind: 'unknown', httpStatus: undefined, detail: undefined, engine: undefined, continuable: undefined, known: undefined },
    ]);
  });

  it('les champs de l\'erreur Kotlin sont ceux que lit l\'appli (contrat avec PlayerEngine.kt et MpvEngine.kt)', () => {
    const dir = resolve(__dirname, '../../../../src-tauri/plugins/tauri-plugin-nyx-android/android/src/main/java/com/nyxplayer/nativebridge');
    const engine = readFileSync(resolve(dir, 'PlayerEngine.kt'), 'utf8');
    const mpv = readFileSync(resolve(dir, 'MpvEngine.kt'), 'utf8');
    const payloadFn = /fun errorPayload\([\s\S]*?\n {4}\}/.exec(engine)?.[0] ?? '';
    // Champs ajoutés après errorPayload(...) : `.apply { put("continuable", true) ... }`
    const extra = [...mpv.matchAll(/errorPayload\([^)]*\)\.apply \{([\s\S]*?)\}\)/g)].flatMap((m) => [...m[1].matchAll(/put\("(\w+)"/g)].map((p) => p[1]));
    const sent = new Set([...[...payloadFn.matchAll(/put\("(\w+)"/g)].map((m) => m[1]), ...extra]);

    const ts = readFileSync(resolve(__dirname, '../androidPlayer.ts'), 'utf8');
    const read = new Set([.../interface NativeErrorPayload \{([\s\S]*?)\}/.exec(ts)?.[1].matchAll(/(\w+)\?:/g) ?? []].map((m) => m[1]));

    expect(sent.size).toBeGreaterThanOrEqual(4);
    expect([...sent].filter((key) => !read.has(key))).toEqual([]);
  });

  it('les codes d\'erreur émis par MpvEngine.kt sont tous classés (aucun ne tombe dans « inconnu »)', async () => {
    const { classifyNativeError } = await import('../playbackErrors');
    const dir = resolve(__dirname, '../../../../src-tauri/plugins/tauri-plugin-nyx-android/android/src/main/java/com/nyxplayer/nativebridge');
    const mpv = readFileSync(resolve(dir, 'MpvEngine.kt'), 'utf8');
    // Codes d'échec d'ouverture choisis par PlaybackPolicy.loadFailureCode : tous vérifiés
    const policy = readFileSync(resolve(dir, 'PlaybackPolicy.kt'), 'utf8');
    const policyCodes = new Map([...policy.matchAll(/const val (\w+)\s*=\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
    const constants = new Map([...mpv.matchAll(/const val (\w+)\s*=\s*"(\w+)"/g)].map((m) => [m[1], m[2]]));
    const emitted = [...mpv.matchAll(/errorPayload\(\s*\w+\s*,\s*(?:"(\w+)"|(?:PlaybackPolicy\.)?(\w+))/g)]
      // `code` : variable calculée par loadFailureCode, couverte par les constantes de PlaybackPolicy
      .filter((m) => m[1] !== undefined || /^[A-Z_]+$/.test(m[2]))
      .map((m) => m[1] ?? constants.get(m[2]) ?? policyCodes.get(m[2]) ?? m[2]);
    const codes = [...emitted, ...policyCodes.values()];
    expect(policyCodes.size).toBeGreaterThanOrEqual(2);
    expect(codes.length).toBeGreaterThanOrEqual(3);
    expect(codes.filter((code) => classifyNativeError(code) === 'unknown')).toEqual([]);
  });
});
