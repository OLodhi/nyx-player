// @vitest-environment node
// Cycle de vie Android des plugins selon la version de Tauri. En 2.11, TauriActivity ne relaie plus
// onResume, onPause et onStop aux plugins (l'observateur prévu n'est jamais branché) : sans relais
// dans MainActivity, le lecteur continuait de jouer quand l'app passait en arrière-plan. Tauri 2.12
// les relaie de nouveau : le relais doit alors disparaître, sinon chaque plugin les reçoit deux fois.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../src-tauri/', import.meta.url));
const lock = readFileSync(`${root}Cargo.lock`, 'utf8');
const mainActivity = readFileSync(
  `${root}gen/android/app/src/main/java/com/nyxplayer/app/MainActivity.kt`,
  'utf8',
);

/** Version de tauri retenue dans Cargo.lock, en [majeure, mineure]. */
function tauriVersion(lockText) {
  const match = lockText.match(/\[\[package\]\]\r?\nname = "tauri"\r?\nversion = "(\d+)\.(\d+)\.\d+"/);
  if (!match) throw new Error('tauri absent de Cargo.lock');
  return [Number(match[1]), Number(match[2])];
}

/** Événements relayés aux plugins par MainActivity (PluginManager.onX()). */
function relayedEvents(source) {
  return [...source.matchAll(/PluginManager\.(on\w+)\(\)/g)].map((m) => m[1]).sort();
}

describe('cycle de vie Android des plugins', () => {
  it('lit la version de tauri et les relais', () => {
    expect(tauriVersion('[[package]]\nname = "tauri"\nversion = "2.11.6"\n')).toEqual([2, 11]);
    // Cargo.lock extrait en CRLF sur le PC (core.autocrlf)
    expect(tauriVersion('[[package]]\r\nname = "tauri"\r\nversion = "2.12.0"\r\n')).toEqual([2, 12]);
    expect(relayedEvents('PluginManager.onStop()\nPluginManager.onResume()')).toEqual(['onResume', 'onStop']);
  });

  it('MainActivity relaie onResume, onPause et onStop seulement là où Tauri ne le fait pas', () => {
    const [major, minor] = tauriVersion(lock);
    const tauriForgetsThem = major === 2 && minor === 11;
    expect(relayedEvents(mainActivity)).toEqual(tauriForgetsThem ? ['onPause', 'onResume', 'onStop'] : []);
  });
});
