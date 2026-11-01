/**
 * mpvApi : erreurs du lecteur sur les deux plateformes.
 * Le point d'entrée unique ne doit ni avaler un refus du moteur, ni appeler le mauvais côté.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoke, plugin, android, platform, forced } = vi.hoisted(() => ({
  invoke: vi.fn(),
  plugin: { observeProperties: vi.fn(), listenEvents: vi.fn() },
  android: {
    init: vi.fn(),
    command: vi.fn(),
    setProperty: vi.fn(),
    getProperty: vi.fn(),
    observeProperties: vi.fn(),
    listenMediaCommands: vi.fn(),
    setVideoMarginRatio: vi.fn(),
  },
  platform: { android: false },
  forced: { cancelForcedUnpause: vi.fn() },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('tauri-plugin-mpv-api', () => plugin);
vi.mock('../../../utils/platform', () => ({ isAndroid: () => platform.android }));
vi.mock('../androidPlayer', () => android);
vi.mock('../forcedUnpause', () => forced);

import * as mpvApi from '../mpvApi';

const refused = new Error('moteur indisponible');

const resetAll = () => {
  invoke.mockReset().mockResolvedValue(undefined);
  [...Object.values(plugin), ...Object.values(android), forced.cancelForcedUnpause].forEach((fn) => fn.mockReset());
};

describe('mpvApi — Android', () => {
  beforeEach(() => {
    resetAll();
    platform.android = true;
  });

  it('les refus du plugin natif remontent tels quels, sans passer par la garde Windows', async () => {
    Object.values(android).forEach((fn) => fn.mockRejectedValue(refused));
    await expect(mpvApi.init()).rejects.toBe(refused);
    await expect(mpvApi.command('loadfile', ['http://test.invalid/live/1.ts'])).rejects.toBe(refused);
    await expect(mpvApi.setProperty('volume', 40)).rejects.toBe(refused);
    await expect(mpvApi.getProperty('time-pos')).rejects.toBe(refused);
    await expect(mpvApi.observeProperties(['pause'], () => {})).rejects.toBe(refused);
    await expect(mpvApi.listenMediaCommands(() => {})).rejects.toBe(refused);
    await expect(mpvApi.setVideoMarginRatio({ left: 0.2 })).rejects.toBe(refused);
    expect(invoke).not.toHaveBeenCalled();
    Object.values(plugin).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('init ignore la configuration Windows (aucun mpv.exe sur Android)', async () => {
    android.init.mockResolvedValue('main');
    await expect(mpvApi.init({ args: ['--vo=gpu'], observedProperties: [], ipcTimeoutMs: 1 })).resolves.toBe('main');
    expect(android.init).toHaveBeenCalledWith();
  });

  it('moteur toujours « vivant » et événements desktop sans effet : rien n\'est demandé à Rust', async () => {
    await expect(mpvApi.isEngineAlive()).resolves.toBe(true);
    const unlisten = await mpvApi.listenDesktopEvents(() => {});
    expect(() => unlisten()).not.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(plugin.listenEvents).not.toHaveBeenCalled();
  });

  it('une pause demandée annule la reprise automatique, même si le plugin la refuse', async () => {
    android.command.mockRejectedValue(refused);
    android.setProperty.mockRejectedValue(refused);
    await expect(mpvApi.command('cycle', ['pause'])).rejects.toBe(refused);
    await expect(mpvApi.setProperty('pause', true)).rejects.toBe(refused);
    expect(forced.cancelForcedUnpause).toHaveBeenCalledTimes(2);
  });
});

describe('mpvApi — Windows', () => {
  beforeEach(() => {
    resetAll();
    platform.android = false;
  });

  it('init sans configuration est refusé avant tout appel', async () => {
    await expect(mpvApi.init()).rejects.toThrow('mpv config required');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('les refus de la garde Rust remontent tels quels', async () => {
    invoke.mockRejectedValue('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.init({ args: [], observedProperties: [], ipcTimeoutMs: 1000 })).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.command('screenshot-to-file', ['/tmp/x.png'])).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.setProperty('volume', 40)).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.getProperty('time-pos')).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.setVideoMarginRatio({ left: 0.2 })).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    await expect(mpvApi.isEngineAlive()).rejects.toBe('Commande mpv refusée : screenshot-to-file');
    Object.values(android).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('mpv.exe arrêté : isEngineAlive répond non', async () => {
    invoke.mockResolvedValue(false);
    await expect(mpvApi.isEngineAlive()).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith('nyx_mpv_alive');
  });

  it('écouteurs du plugin mpv impossibles à attacher : l\'erreur remonte', async () => {
    plugin.observeProperties.mockRejectedValue(refused);
    plugin.listenEvents.mockRejectedValue(refused);
    await expect(mpvApi.observeProperties(['pause'], () => {})).rejects.toBe(refused);
    await expect(mpvApi.listenDesktopEvents(() => {})).rejects.toBe(refused);
  });

  it('commandes média : sans effet hors Android', async () => {
    const unlisten = await mpvApi.listenMediaCommands(() => {});
    expect(() => unlisten()).not.toThrow();
    expect(android.listenMediaCommands).not.toHaveBeenCalled();
  });

  it('une pause demandée annule la reprise automatique, même si mpv la refuse', async () => {
    invoke.mockRejectedValue(refused);
    await expect(mpvApi.command('cycle', ['pause'])).rejects.toBe(refused);
    await expect(mpvApi.setProperty('pause', false)).rejects.toBe(refused);
    // Les autres commandes ne touchent pas à la reprise automatique
    await expect(mpvApi.command('stop')).rejects.toBe(refused);
    await expect(mpvApi.setProperty('volume', 10)).rejects.toBe(refused);
    expect(forced.cancelForcedUnpause).toHaveBeenCalledTimes(2);
  });
});
