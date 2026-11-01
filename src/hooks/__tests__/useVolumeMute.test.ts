/**
 * Son coupé après la sourdine.
 *
 * Sous Windows, mpv.exe reste lancé d'une lecture à l'autre et garde sa sourdine ; l'abonnement aux
 * propriétés ne renvoie que les changements. Le lecteur suivant affichait donc le son actif alors que
 * mpv l'avait coupé : la sourdine renvoyait « coupé » (déjà en place) et la barre de volume ne
 * rétablissait pas le son, jusqu'au redémarrage de l'application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type PropertyEvent = { name: string; data?: unknown };

/** mpv simulé : garde son état entre deux lecteurs, ne signale que les changements (comme sous Windows) */
const { fakeMpv, mpvStop } = vi.hoisted(() => {
  const state: Record<string, unknown> = { mute: false, volume: 100 };
  const listeners = new Set<(e: PropertyEvent) => void>();
  return {
    mpvStop: vi.fn().mockResolvedValue(undefined),
    fakeMpv: {
      state,
      listeners,
      setProperty: vi.fn(async (name: string, value: unknown) => {
        if (state[name] === value) return;
        state[name] = value;
        listeners.forEach((cb) => cb({ name, data: value }));
      }),
      getProperty: vi.fn(async (name: string) => (name in state ? state[name] : null)),
      observeProperties: vi.fn(async (_props: string[], cb: (e: PropertyEvent) => void) => {
        listeners.add(cb);
        return () => { listeners.delete(cb); };
      }),
    },
  };
});

vi.mock('../../services/player/mpvApi', () => ({
  setProperty: fakeMpv.setProperty,
  getProperty: fakeMpv.getProperty,
  observeProperties: fakeMpv.observeProperties,
  command: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/mpvBridge', () => ({ mpvStop }));
vi.mock('../../services/player/androidPlayer', () => ({ setFullscreen: vi.fn(), observeProperties: vi.fn() }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => false }));
vi.mock('../../services/preferencesService', () => ({
  isBingeModeEnabled: () => false,
  getBingeCountdown: () => 10,
  isGeekStatsEnabled: () => false,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: () => Promise.resolve(() => {}),
    isFullscreen: () => Promise.resolve(false),
  }),
}));

import { useMpvObserver } from '../useMpvObserver';
import { usePlayerActions } from '../usePlayerActions';

/** Un lecteur ouvert : observation de mpv + actions des boutons */
function openPlayer() {
  return renderHook(() => {
    const mpv = useMpvObserver(true, undefined, undefined, false);
    const actions = usePlayerActions({
      mpv, prefs: { savePlaybackPosition: async () => {} }, onClose: () => {}, progressRef: { current: null },
    });
    return { mpv, actions };
  });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const volumeEvent = (value: number) => ({ target: { value: String(value) } }) as React.ChangeEvent<HTMLInputElement>;

describe('sourdine et volume d\'un lecteur à l\'autre', () => {
  beforeEach(() => {
    fakeMpv.state.mute = false;
    fakeMpv.state.volume = 100;
    fakeMpv.listeners.clear();
    fakeMpv.setProperty.mockClear();
  });

  it('le lecteur affiche la sourdine et le volume réels de mpv dès son ouverture', async () => {
    fakeMpv.state.mute = true;
    fakeMpv.state.volume = 40;
    const { result } = openPlayer();
    await flush();

    expect(result.current.mpv.isMuted).toBe(true);
    expect(result.current.mpv.volume).toBe(40);
    expect(result.current.mpv.volumeRef.current).toBe(40);
  });

  it('sourdine, fermeture, nouveau lecteur : le son revient', async () => {
    const first = openPlayer();
    await flush();
    await act(async () => { await first.result.current.actions.toggleMute(); });
    expect(fakeMpv.state.mute).toBe(true);
    expect(first.result.current.mpv.isMuted).toBe(true);

    await act(async () => { await first.result.current.actions.handleClose(); });
    first.unmount();
    expect(fakeMpv.state.mute).toBe(false);

    const second = openPlayer();
    await flush();
    expect(second.result.current.mpv.isMuted).toBe(false);
  });

  it('mpv coupé mais affichage en retard : la sourdine rétablit le son', async () => {
    const { result } = openPlayer();
    await flush();
    fakeMpv.state.mute = true; // changement non signalé

    await act(async () => { await result.current.actions.toggleMute(); });
    expect(fakeMpv.state.mute).toBe(false);
    expect(result.current.mpv.isMuted).toBe(false);
  });

  it('mpv coupé mais affichage en retard : monter le volume rétablit le son', async () => {
    const { result } = openPlayer();
    await flush();
    fakeMpv.state.mute = true;

    await act(async () => { await result.current.actions.handleVolumeChange(volumeEvent(60)); });
    expect(fakeMpv.state.mute).toBe(false);
    expect(fakeMpv.state.volume).toBe(60);
    expect(result.current.mpv.isMuted).toBe(false);
  });

  it('volume à 0 : la sourdine n\'est pas touchée', async () => {
    const { result } = openPlayer();
    await flush();
    fakeMpv.setProperty.mockClear();

    await act(async () => { await result.current.actions.handleVolumeChange(volumeEvent(0)); });
    expect(fakeMpv.setProperty).not.toHaveBeenCalledWith('mute', expect.anything());
  });
});
