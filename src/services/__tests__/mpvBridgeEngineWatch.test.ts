/**
 * Windows : mpv.exe arrêté PENDANT une lecture (plantage, arrêt forcé).
 *
 * Avant : le plugin ne signalait rien, la page du lecteur restait ouverte, transparente et sans
 * message ; il fallait la quitter soi-même. Maintenant l'état du processus est vérifié pendant la
 * lecture et l'écran « Lecture interrompue » (Réessayer / Fermer) s'affiche.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { init, command, setProperty, isEngineAlive, listenDesktopEvents, platform } = vi.hoisted(() => ({
  init: vi.fn(),
  listenDesktopEvents: vi.fn().mockResolvedValue(() => {}),
  command: vi.fn(),
  setProperty: vi.fn(),
  isEngineAlive: vi.fn(),
  platform: { os: 'windows' as 'android' | 'ios' | 'windows' },
}));

vi.mock('../player/mpvApi', () => ({
  init,
  command,
  setProperty,
  isEngineAlive,
  listenDesktopEvents,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../appSettingsService', () => ({ isHardwareAccelerationEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => platform.os === 'android', usesNyxPlugin: () => platform.os !== 'windows' }));

import type { PlaybackError } from '../player/playbackErrors';

type Bridge = typeof import('../mpvBridge');
type Errors = typeof import('../player/playbackErrors');

describe('mpvBridge — mpv.exe arrêté pendant la lecture', () => {
  let bridge: Bridge;
  let errors: PlaybackError[];
  let unsubscribe: () => void;
  let alive: boolean;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Module neuf à chaque test : la surveillance démarre au premier lancement de mpv
    vi.resetModules();
    platform.os = 'windows';
    alive = true;
    init.mockReset().mockImplementation(async () => {
      alive = true;
      return 'main';
    });
    command.mockReset().mockResolvedValue(undefined);
    setProperty.mockReset().mockResolvedValue(undefined);
    isEngineAlive.mockReset().mockImplementation(async () => alive);
    bridge = await import('../mpvBridge');
    const playbackErrors: Errors = await import('../player/playbackErrors');
    errors = [];
    unsubscribe = playbackErrors.subscribePlaybackErrors((e) => errors.push(e));
  });

  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const tick = () => vi.advanceTimersByTimeAsync(bridge.ENGINE_WATCH_INTERVAL_MS);

  it('mpv.exe planté pendant la lecture : écran « Lecture interrompue », une seule fois', async () => {
    await bridge.mpvPlay('http://test.invalid/live/1.ts', undefined, { live: true });
    await tick();
    expect(errors).toEqual([]);

    alive = false;
    await tick();
    await tick();

    expect(errors).toEqual([{ kind: 'engine_stopped', engine: 'mpv' }]);
  });

  it('Réessayer relance mpv.exe et recharge le flux', async () => {
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    alive = false;
    await tick();
    init.mockClear();
    command.mockClear();

    await bridge.mpvPlay('http://test.invalid/live/1.ts');

    expect(init).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith('loadfile', ['http://test.invalid/live/1.ts', 'replace']);
    // La surveillance reprend sur le nouveau processus
    alive = false;
    await tick();
    expect(errors).toHaveLength(2);
  });

  it('mpv.exe arrêté sans flux en cours (lecteur fermé) : aucun message, relancé à la lecture suivante', async () => {
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    await bridge.mpvStop();
    alive = false;
    await tick();

    expect(errors).toEqual([]);
    init.mockClear();
    await bridge.mpvPlay('http://test.invalid/live/2.ts');
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('zap pendant la vérification : pas d\'écran « Lecture interrompue » sur la nouvelle chaîne', async () => {
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    alive = false;
    // mpv.exe arrêté, la vérification part, l'utilisateur zappe avant sa réponse
    let answer: (value: boolean) => void = () => {};
    isEngineAlive.mockImplementationOnce(() => new Promise<boolean>((resolve) => { answer = resolve; }));
    await tick();
    const zap = bridge.mpvSwitchChannel('http://test.invalid/live/2.ts');
    answer(false);
    await zap;
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toEqual([]);
  });

  it('vérification impossible (erreur passagère) : pas pris pour un arrêt', async () => {
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    isEngineAlive.mockRejectedValue(new Error('invoke failed'));
    await tick();
    await tick();

    expect(errors).toEqual([]);
  });

  it('Android : libmpv vit dans l\'app, aucune surveillance du processus', async () => {
    platform.os = 'android';
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    alive = false;
    await tick();

    expect(isEngineAlive).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('iOS : aucune surveillance du processus mpv de bureau', async () => {
    platform.os = 'ios';
    listenDesktopEvents.mockClear();
    await bridge.mpvPlay('http://test.invalid/live/1.ts');
    alive = false;
    await tick();
    await tick();

    expect(init).toHaveBeenCalledWith(undefined);
    expect(listenDesktopEvents).not.toHaveBeenCalled();
    expect(isEngineAlive).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('iOS : une erreur de tube n\'est pas prise pour un mpv.exe arrêté, rien n\'est relancé', async () => {
    platform.os = 'ios';
    const pipeClosed = 'IPC communication error: pipe closed';
    command.mockImplementation(async (name: string) => {
      if (name === 'loadfile') throw pipeClosed;
    });
    await expect(bridge.mpvPlay('http://test.invalid/live/1.ts')).rejects.toBe(pipeClosed);
    expect(init).toHaveBeenCalledTimes(1);
  });
});
