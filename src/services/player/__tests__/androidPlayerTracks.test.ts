/**
 * Plugin Android : traduction des valeurs mpv de aid/sid (retour au choix automatique avant un direct).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, addPluginListener: vi.fn() }));

import { setProperty, command } from '../androidPlayer';

const selected = () => invoke.mock.calls.map(([, args]) => args);

describe('androidPlayer — pistes', () => {
  beforeEach(() => invoke.mockClear());

  it('auto = -1 (choix de mpv), aucune piste = 0, sinon l\'id', async () => {
    await setProperty('aid', 'auto');
    await setProperty('sid', 'auto');
    await setProperty('sid', false);
    await setProperty('sid', 'no');
    await setProperty('aid', 2);
    expect(selected()).toEqual([
      { type: 'audio', id: -1 },
      { type: 'sub', id: -1 },
      { type: 'sub', id: 0 },
      { type: 'sub', id: 0 },
      { type: 'audio', id: 2 },
    ]);
  });
});

describe('androidPlayer — position de départ', () => {
  beforeEach(() => invoke.mockClear());

  it('option start transmise au chargement suivant, puis retirée par « none »', async () => {
    await setProperty('start', '1234.5');
    await command('loadfile', ['http://test.invalid/movie/7.mkv', 'replace']);
    await setProperty('start', 'none');
    await command('loadfile', ['http://test.invalid/live/1.ts', 'replace']);
    const plays = invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:nyx-android|play').map(([, args]) => args.start);
    expect(plays).toEqual([1234.5, 0]);
  });
});
