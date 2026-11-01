/**
 * Windows : le lecteur passe par la garde Rust, jamais par les commandes brutes du
 * plugin mpv, retirées des permissions (`src-tauri/capabilities/desktop.json`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const { invoke, plugin } = vi.hoisted(() => ({
  invoke: vi.fn(),
  plugin: { init: vi.fn(), command: vi.fn(), setProperty: vi.fn(), getProperty: vi.fn(), setVideoMarginRatio: vi.fn() },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('tauri-plugin-mpv-api', () => plugin);
vi.mock('../../../utils/platform', () => ({ isAndroid: () => false }));
vi.mock('../androidPlayer', () => ({}));

import { init, command, setProperty, getProperty, setVideoMarginRatio } from '../mpvApi';

describe('mpvApi — Windows', () => {
  beforeEach(() => {
    invoke.mockReset().mockResolvedValue(null);
    Object.values(plugin).forEach((fn) => fn.mockReset());
  });

  it('lance mpv sans chemin de programme : il est fixé côté Rust', async () => {
    invoke.mockResolvedValue('main');
    await init({ args: ['--keep-open=yes'], observedProperties: ['pause'], ipcTimeoutMs: 3000 });
    expect(invoke).toHaveBeenCalledWith('nyx_mpv_init', {
      args: ['--keep-open=yes'],
      observedProperties: ['pause'],
      ipcTimeoutMs: 3000,
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('mpv.exe');
  });

  it('commandes et propriétés passent par nyx_mpv_command', async () => {
    await command('loadfile', ['http://h.invalid/live/1.ts', 'replace']);
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_command', { name: 'loadfile', args: ['http://h.invalid/live/1.ts', 'replace'] });

    await command('stop');
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_command', { name: 'stop', args: [] });

    await setProperty('volume', 80);
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_command', { name: 'set_property', args: ['volume', 80] });

    invoke.mockResolvedValue(42);
    await expect(getProperty('time-pos')).resolves.toBe(42);
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_command', { name: 'get_property', args: ['time-pos'] });

    await setVideoMarginRatio({ left: 0.4, right: 0, top: 0, bottom: 0 });
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_set_margins', { left: 0.4, right: 0, top: 0, bottom: 0 });
    await setVideoMarginRatio({ left: 0.4 });
    expect(invoke).toHaveBeenLastCalledWith('nyx_mpv_set_margins', { left: 0.4, right: null, top: null, bottom: null });

    Object.values(plugin).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('une commande refusée ou un mpv arrêté remonte en erreur', async () => {
    invoke.mockRejectedValue('IPC communication error: pipe closed');
    await expect(command('stop')).rejects.toBe('IPC communication error: pipe closed');
  });

  it('aucune permission ne donne accès aux commandes brutes du plugin', () => {
    for (const file of ['default.json', 'desktop.json']) {
      const capability = JSON.parse(readFileSync(resolve(__dirname, '../../../../src-tauri/capabilities', file), 'utf8')) as { permissions: string[] };
      expect(capability.permissions.filter((p) => p.startsWith('mpv:')), file).toEqual([]);
    }
  });

  it('chaque propriété modifiée par l\'app est dans la liste blanche Rust (sinon refusée sous Windows seulement)', () => {
    const guard = readFileSync(resolve(__dirname, '../../../../src-tauri/src/mpv_guard.rs'), 'utf8');
    const list = /const SETTABLE_PROPERTIES: &\[&str\] = &\[([\s\S]*?)\];/.exec(guard)?.[1] ?? '';
    const allowed = new Set([...list.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const text = readFileSync(path, 'utf8');
        for (const m of text.matchAll(/(?<![.\w])setProperty(?:<[^>]*>)?\(\s*['"]([a-z-]+)['"]/g)) used.add(m[1]);
      }
    };
    walk(resolve(__dirname, '../../..'));
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((name) => !allowed.has(name));
    expect(missing).toEqual([]);
  });
});
