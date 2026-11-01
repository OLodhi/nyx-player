/**
 * Windows : mpv.exe vérifie les certificats HTTPS avec les autorités du système
 * exportées par Rust (`mpv_tls.rs`). Si cet export a échoué, un flux HTTPS est refusé par mpv :
 * l'app doit l'expliquer (« Connexion sécurisée impossible à vérifier ») au lieu de sonder le flux
 * et d'afficher une erreur générique. Les flux HTTP et le cas normal ne changent pas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MpvEvent } from 'tauri-plugin-mpv-api';
import type { PlaybackError } from '../player/playbackErrors';

const { invoke, events, state } = vi.hoisted(() => ({
  invoke: vi.fn(),
  events: { callback: null as ((e: MpvEvent) => void) | null },
  state: { tlsReady: true },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('tauri-plugin-mpv-api', () => ({
  listenEvents: vi.fn(async (cb: (e: MpvEvent) => void) => { events.callback = cb; return () => {}; }),
}));
vi.mock('../appSettingsService', () => ({ isHardwareAccelerationEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => false }));
vi.mock('../player/androidPlayer', () => ({}));

const HTTPS = 'https://fournisseur.exemple.invalid/movie/u/p/1.mkv';
const HTTP = 'http://fournisseur.exemple.invalid:8080/live/u/p/1.ts';
const endFileError = { event: 'end-file', reason: 'error' } as unknown as MpvEvent;
const calls = (name: string) => invoke.mock.calls.filter(([cmd]) => cmd === name);

async function load() {
  vi.resetModules();
  events.callback = null;
  const bridge = await import('../mpvBridge');
  const { subscribePlaybackErrors } = await import('../player/playbackErrors');
  const errors: PlaybackError[] = [];
  subscribePlaybackErrors((e) => errors.push(e));
  return { ...bridge, errors };
}

describe('mpvBridge — flux HTTPS sans certificats', () => {
  beforeEach(() => {
    state.tlsReady = true;
    invoke.mockReset().mockImplementation(async (cmd: string) => {
      if (cmd === 'nyx_mpv_alive') return true;
      if (cmd === 'nyx_mpv_tls_ready') return state.tlsReady;
      if (cmd === 'probe_stream_status') return 200;
      return 'main';
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('export raté : un flux HTTPS en échec affiche « connexion sécurisée impossible à vérifier », sans sonde', async () => {
    state.tlsReady = false;
    const { mpvPlay, mpvStop, errors } = await load();
    await mpvPlay(HTTPS);
    events.callback!(endFileError);
    await vi.waitFor(() => expect(errors.map((e) => e.kind)).toEqual(['tls_unavailable']));
    expect(calls('probe_stream_status')).toEqual([]);
    await mpvStop();
  });

  it('certificats exportés : un échec HTTPS est sondé comme avant', async () => {
    const { mpvPlay, mpvStop, errors } = await load();
    await mpvPlay(HTTPS);
    events.callback!(endFileError);
    await vi.waitFor(() => expect(calls('probe_stream_status')).toEqual([['probe_stream_status', { url: HTTPS }]]));
    expect(errors.map((e) => e.kind)).not.toContain('tls_unavailable');
    await mpvStop();
  });

  it('flux HTTP : jamais concerné, même si l\'export a raté', async () => {
    state.tlsReady = false;
    const { mpvPlay, mpvStop, errors } = await load();
    await mpvPlay(HTTP);
    events.callback!(endFileError);
    await vi.waitFor(() => expect(calls('probe_stream_status')).toHaveLength(1));
    expect(calls('nyx_mpv_tls_ready')).toEqual([]);
    expect(errors.map((e) => e.kind)).not.toContain('tls_unavailable');
    await mpvStop();
  });
});
