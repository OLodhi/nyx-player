/**
 * Windows : mpv.exe arrêté (plantage, fermé depuis le gestionnaire des tâches) pendant que l'app
 * tourne.
 *
 * Avant : le drapeau « initialisé » ne repassait jamais à faux, `init` n'était plus rappelé et chaque
 * `loadfile` échouait sur le tube fermé : plus aucune lecture avant de relancer l'app. Le plugin sait
 * pourtant relancer mpv.exe quand on lui redemande `init` (processus terminé = nouveau processus).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { init, command, setProperty, platform } = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue('main'),
  command: vi.fn().mockResolvedValue(undefined),
  setProperty: vi.fn().mockResolvedValue(undefined),
  platform: { android: false },
}));

vi.mock('../player/mpvApi', () => ({
  init,
  command,
  setProperty,
  listenDesktopEvents: vi.fn().mockResolvedValue(() => {}),
  isEngineAlive: vi.fn().mockResolvedValue(true),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ resolveResource: vi.fn().mockResolvedValue('C:/Nyx/mpv/mpv.exe') }));
vi.mock('../appSettingsService', () => ({ isHardwareAccelerationEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => platform.android }));

import { mpvPlay, mpvSwitchChannel, mpvStop, onMpvConnectionChange } from '../mpvBridge';

/** Message rendu par tauri-plugin-mpv quand le tube de mpv.exe est fermé */
const PIPE_CLOSED = 'IPC communication error: Failed to connect to mpv IPC pipe: Le fichier spécifié est introuvable.';

describe('mpvBridge — mpv.exe arrêté pendant que l\'app tourne', () => {
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let alive: boolean;

  beforeEach(async () => {
    vi.useFakeTimers();
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    platform.android = false;
    alive = true;
    // Le plugin : `init` relance mpv.exe s'il s'est arrêté ; toute commande échoue tant qu'il est arrêté
    init.mockReset().mockImplementation(async () => {
      alive = true;
      return 'main';
    });
    command.mockReset().mockImplementation(async () => {
      if (!alive) throw PIPE_CLOSED;
      return undefined;
    });
    setProperty.mockReset().mockImplementation(async () => {
      if (!alive) throw PIPE_CLOSED;
    });
    // Première lecture : mpv.exe démarré
    await mpvPlay('http://test.invalid/live/1.ts', undefined, { live: true });
    await vi.advanceTimersByTimeAsync(1000);
    init.mockClear();
    command.mockClear();
    setProperty.mockClear();
  });

  afterEach(async () => {
    alive = true;
    await mpvStop().catch(() => {});
    info.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
  });

  const loads = () => command.mock.calls.filter(([name]) => name === 'loadfile').map(([, args]) => (args as string[])[0]);

  it('la lecture suivante relance mpv.exe et charge le flux', async () => {
    alive = false; // mpv.exe planté pendant la lecture

    await mpvPlay('http://test.invalid/movie/2.mkv');

    expect(init).toHaveBeenCalledTimes(1);
    expect(loads()).toEqual(['http://test.invalid/movie/2.mkv']);
  });

  it('un zap relance mpv.exe et charge la chaîne, réglages du direct compris', async () => {
    alive = false;

    await mpvSwitchChannel('http://test.invalid/live/3.ts', { live: true });

    expect(init).toHaveBeenCalledTimes(1);
    // Premier essai sur le tube fermé, second sur le nouveau mpv.exe
    expect(loads()).toEqual(['http://test.invalid/live/3.ts', 'http://test.invalid/live/3.ts']);
    // Vitesse et pistes remises à zéro sur le nouveau mpv.exe (le premier essai a échoué)
    expect(setProperty).toHaveBeenCalledWith('aid', 'auto');
  });

  it('l\'interface voit le lecteur se déconnecter puis revenir', async () => {
    const states: string[] = [];
    const unsubscribe = onMpvConnectionChange((s) => states.push(s));
    alive = false;

    await mpvSwitchChannel('http://test.invalid/live/3.ts', { live: true });

    expect(states).toEqual(['connected', 'disconnected', 'connecting', 'connected']);
    unsubscribe();
  });

  it('fermer le lecteur après l\'arrêt de mpv.exe ne lève pas d\'erreur, et la lecture suivante repart', async () => {
    alive = false;

    await expect(mpvStop()).resolves.toBeUndefined();
    await mpvPlay('http://test.invalid/movie/2.mkv');

    expect(init).toHaveBeenCalledTimes(1);
    expect(loads()).toEqual(['http://test.invalid/movie/2.mkv']);
  });

  it('mpv.exe vivant : aucune relance, et une autre erreur de chargement remonte comme avant', async () => {
    await mpvSwitchChannel('http://test.invalid/live/3.ts');
    expect(init).not.toHaveBeenCalled();

    command.mockImplementation(async (name: string) => {
      if (name === 'loadfile') throw 'mpv command failed: invalid parameter';
    });
    await expect(mpvSwitchChannel('http://test.invalid/live/4.ts')).rejects.toBe('mpv command failed: invalid parameter');
    expect(init).not.toHaveBeenCalled();
  });

  it('une seule relance : si mpv.exe ne repart pas, l\'erreur remonte au lieu de boucler', async () => {
    alive = false;
    init.mockImplementation(async () => 'main'); // relance sans effet

    await expect(mpvSwitchChannel('http://test.invalid/live/3.ts')).rejects.toBe(PIPE_CLOSED);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('mpv.exe lent (délai de réponse dépassé) : pas pris pour arrêté, le chargement n\'est pas envoyé deux fois', async () => {
    const timeout = 'IPC communication error: Timeout: Did not receive a response for request_id 7 within 3s';
    command.mockImplementation(async (name: string) => {
      if (name === 'loadfile') throw timeout;
    });

    await expect(mpvSwitchChannel('http://test.invalid/live/3.ts')).rejects.toBe(timeout);
    expect(init).not.toHaveBeenCalled();
    expect(loads()).toHaveLength(1);
  });

  it('après une relance, l\'option « start » d\'un film repris est retirée au chargement suivant', async () => {
    await mpvPlay('http://test.invalid/movie/2.mkv', 2400);
    alive = false;
    await mpvStop();
    setProperty.mockClear();

    await mpvSwitchChannel('http://test.invalid/live/3.ts');

    expect(setProperty).toHaveBeenCalledWith('start', 'none');
  });
});

