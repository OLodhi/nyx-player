/**
 * Pause dans la demi-seconde après un lancement : toute demande de pause passée par
 * mpvApi annule la reprise automatique programmée par mpvBridge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('tauri-plugin-mpv-api', () => ({}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock('../../../utils/platform', () => ({ isAndroid: () => false, usesNyxPlugin: () => false }));
vi.mock('../androidPlayer', () => ({}));

import { setProperty, command } from '../mpvApi';
import { scheduleForcedUnpause } from '../forcedUnpause';

describe('reprise automatique après chargement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pause demandée (propriété pause) : la reprise ne part pas', async () => {
    const run = vi.fn();
    scheduleForcedUnpause(run, 500);
    await setProperty('pause', true);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('pause basculée (cycle pause) : la reprise ne part pas', async () => {
    const run = vi.fn();
    scheduleForcedUnpause(run, 500);
    await command('cycle', ['pause']);
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('autre réglage (volume) : la reprise part comme avant', async () => {
    const run = vi.fn();
    scheduleForcedUnpause(run, 500);
    await setProperty('volume', 50);
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
