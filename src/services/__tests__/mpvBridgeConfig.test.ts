/**
 * mpv.exe (Windows) : protections de la Live TV.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { init, command, setProperty } = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue('main'),
  command: vi.fn().mockResolvedValue(undefined),
  setProperty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../player/mpvApi', () => ({
  init,
  command,
  setProperty,
  listenDesktopEvents: vi.fn().mockResolvedValue(() => {}),
  isEngineAlive: vi.fn().mockResolvedValue(true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../appSettingsService', () => ({ isHardwareAccelerationEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => false }));

import { mpvPlay, mpvSwitchChannel, mpvStop } from '../mpvBridge';
import { cancelForcedUnpause } from '../player/forcedUnpause';
import type { MpvConfig } from '../player/mpvApi';

/** Ordre des appels à mpv : ['set speed', 'loadfile', …] */
const calls = () => {
  const order: Array<{ at: number; label: string }> = [];
  setProperty.mock.calls.forEach(([name, value], i) => order.push({ at: setProperty.mock.invocationCallOrder[i], label: `set ${name}=${value}` }));
  command.mock.calls.forEach(([name], i) => order.push({ at: command.mock.invocationCallOrder[i], label: name }));
  return order.sort((a, b) => a.at - b.at).map((c) => c.label);
};

describe('mpvBridge — Live TV', () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    command.mockClear();
    setProperty.mockClear();
  });
  afterEach(() => {
    info.mockRestore();
    vi.useRealTimers();
  });

  it('observe la fin de flux (keep-open : un direct coupé se fige en pause sur la dernière image)', async () => {
    await mpvPlay('http://test.invalid/movie/1.mkv');
    const config = init.mock.calls[0][0] as MpvConfig;
    expect(config.args).toContain('--keep-open=yes');
    expect(config.observedProperties).toContain('eof-reached');
  });

  it('une chaîne repart en ×1 sur ses pistes par défaut, réglées avant le chargement', async () => {
    await mpvPlay('http://test.invalid/live/1.ts', undefined, { live: true });
    expect(calls()).toEqual(['stop', 'set speed=1', 'set aid=auto', 'set sid=auto', 'loadfile']);

    command.mockClear();
    setProperty.mockClear();
    await mpvSwitchChannel('http://test.invalid/live/2.ts', { live: true });
    expect(calls()).toEqual(['set speed=1', 'set aid=auto', 'set sid=auto', 'loadfile']);
  });

  it('films et épisodes gardent le comportement actuel (pistes d\'un épisode reprises au suivant)', async () => {
    await mpvPlay('http://test.invalid/series/7.mkv');
    expect(calls()).toEqual(['stop', 'loadfile']);
  });
});

describe('mpvBridge — reprise, zap rapide, pause et arrêt', () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    vi.useFakeTimers();
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    command.mockReset().mockResolvedValue(undefined);
    setProperty.mockReset().mockResolvedValue(undefined);
    // État du module remis à zéro : option start retirée, aucun flux chargé
    await mpvSwitchChannel('http://test.invalid/live/0.ts');
    await mpvStop();
    await vi.advanceTimersByTimeAsync(1000);
    command.mockReset().mockResolvedValue(undefined);
    setProperty.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    info.mockRestore();
    vi.useRealTimers();
  });

  it('reprise : le film s\'ouvre directement à la position (option start), sans saut après chargement', async () => {
    await mpvPlay('http://test.invalid/movie/7.mkv', 1234.5);
    expect(calls()).toEqual(['stop', 'set start=1234.5', 'loadfile']);
  });

  it('l\'option start est retirée au lancement suivant (chaîne ou film sans reprise)', async () => {
    await mpvPlay('http://test.invalid/movie/7.mkv', 600);
    setProperty.mockClear();
    command.mockClear();
    await mpvSwitchChannel('http://test.invalid/live/2.ts');
    expect(calls()).toEqual(['set start=none', 'loadfile']);

    // Déjà retirée : pas d'appel supplémentaire au zap suivant
    setProperty.mockClear();
    command.mockClear();
    await mpvSwitchChannel('http://test.invalid/live/3.ts');
    expect(calls()).toEqual(['loadfile']);
  });

  it('une pause dans la demi-seconde après le lancement n\'est plus annulée', async () => {
    await mpvPlay('http://test.invalid/movie/7.mkv');
    // L'utilisateur met en pause (usePlayerActions → mpvApi.setProperty → annule la reprise)
    cancelForcedUnpause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(setProperty.mock.calls.filter(([name]) => name === 'pause')).toEqual([]);
  });

  it('sans pause, la reprise automatique part toujours 500 ms après le chargement', async () => {
    await mpvSwitchChannel('http://test.invalid/live/2.ts');
    await vi.advanceTimersByTimeAsync(499);
    expect(setProperty).not.toHaveBeenCalledWith('pause', false);
    await vi.advanceTimersByTimeAsync(1);
    expect(setProperty).toHaveBeenCalledWith('pause', false);
  });

  it('zaps rapides : une demande dépassée par une plus récente ne charge plus rien', async () => {
    // Le premier zap attend la remise à zéro des réglages du direct pendant que le second part
    let release: () => void = () => {};
    setProperty.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = mpvSwitchChannel('http://test.invalid/live/1.ts', { live: true });
    await mpvSwitchChannel('http://test.invalid/live/2.ts');
    release();
    await first;
    const loads = command.mock.calls.filter(([name]) => name === 'loadfile').map(([, args]) => (args as string[])[0]);
    expect(loads).toEqual(['http://test.invalid/live/2.ts']);
  });

  it('un arrêt pendant un lancement en attente : rien n\'est chargé ensuite', async () => {
    let release: () => void = () => {};
    command.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(undefined); }));
    const pending = mpvPlay('http://test.invalid/movie/7.mkv');
    // Le lancement attend le « stop » du flux précédent quand l'utilisateur ferme
    await vi.advanceTimersByTimeAsync(0);
    expect(command).toHaveBeenCalledWith('stop');
    await mpvStop();
    release();
    await pending;
    expect(command.mock.calls.map(([name]) => name)).not.toContain('loadfile');
  });

  it('un seul « stop » envoyé au moteur quand la fermeture et PlayerContext l\'appellent tous deux', async () => {
    await mpvSwitchChannel('http://test.invalid/live/2.ts');
    command.mockClear();
    await mpvStop();
    await mpvStop();
    expect(command.mock.calls.map(([name]) => name)).toEqual(['stop']);
  });

  it('un arrêt annule la reprise automatique en attente', async () => {
    await mpvSwitchChannel('http://test.invalid/live/2.ts');
    await mpvStop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(setProperty).not.toHaveBeenCalledWith('pause', false);
  });
});
