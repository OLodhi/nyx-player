/**
 * iOS: the nyx-android plugin is registered on iOS with its Swift package (same JS name as on
 * Android). The Swift build itself runs in .github/workflows/ios.yml; this checks the wiring text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLUGIN = resolve(__dirname, '../../src-tauri/plugins/tauri-plugin-nyx-android');

describe('plugin nyx-android sur iOS', () => {
  const buildRs = readFileSync(resolve(PLUGIN, 'build.rs'), 'utf8');
  const libRs = readFileSync(resolve(PLUGIN, 'src/lib.rs'), 'utf8');
  const swift = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxIosPlugin/NyxPlugin.swift'), 'utf8');

  it('build.rs déclare le dossier iOS', () => expect(buildRs).toMatch(/\.ios_path\("ios"\)/));

  it('lib.rs enregistre le plugin Swift sur iOS seulement', () => {
    expect(libRs).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*tauri::ios_plugin_binding!\(init_plugin_nyx_android\);/);
    expect(libRs).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*_api\.register_ios_plugin\(init_plugin_nyx_android\)\?;/);
  });

  it('point d’entrée Swift public (édition de liens Xcode 27)', () =>
    expect(swift).toMatch(/@_cdecl\("init_plugin_nyx_android"\)\s*public func initPlugin\(\) -> Plugin/));

  it('device_info : jamais une TV', () => expect(swift).toMatch(/"isTv":\s*false/));

  // No reading from NWPathMonitor yet: reject, so JS assumes connected and unmetered (plugin
  // contract), rather than resolve "offline" and postpone the catalogue refresh.
  it('network_status sans relevé réseau : refusé, pas « hors ligne »', () => {
    const body = swift.split(/@objc\s+public\s+func\s+/).find((part) => part.startsWith('networkStatus('));
    expect(body).toMatch(/guard let status else \{\s*return invoke\.reject\("network_status: no network reading yet"\)/);
  });

  // load(webview:) can run again for a second webview: NWPathMonitor must not be started twice
  it('NetworkMonitor ne démarre NWPathMonitor qu’une fois', () => {
    const monitor = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxIosPlugin/NetworkMonitor.swift'), 'utf8');
    const start = /func start\(\) \{([\s\S]*?)\n {4}\}/.exec(monitor)?.[1] ?? '';
    expect(monitor).toMatch(/private var started = false/);
    expect(start).toMatch(/^\s*guard !started else \{ return \}\s*started = true\n/);
    expect(monitor.match(/monitor\.start\(/g)).toHaveLength(1);
    expect(start).toContain('monitor.start(queue: queue)');
  });

  // MPVKit 1.0.0 (libmpv): the LGPL product only, as the author asked on #23. SwiftPM downloads the
  // -GPL frameworks too (same package); build.rs links an explicit list that never names them.
  it('MPVKit 1.0.0, produit LGPL seulement', () => {
    const pkg = readFileSync(resolve(PLUGIN, 'ios/Package.swift'), 'utf8');
    expect(pkg).toContain('.package(url: "https://github.com/mpvkit/MPVKit.git", exact: "1.0.0")');
    expect(pkg).toContain('.product(name: "MPVKit", package: "MPVKit")');
    expect(pkg).not.toContain('MPVKit-GPL');
  });

  it('build.rs ne lie aucune bibliothèque GPL', () => {
    const list = /const MPVKIT_LGPL: &\[&str\] = &\[([\s\S]*?)\];/.exec(buildRs)?.[1] ?? '';
    expect(list).toContain('"Libmpv"');
    expect(list).not.toMatch(/-GPL|Libsmbclient/);
  });

  it('liaison MPVKit pour iOS seulement', () =>
    expect(buildRs).toMatch(/CARGO_CFG_TARGET_OS[^\n]*"ios"[^\n]*\)\s*\{\s*link_mpvkit\(\);/));

  it('le paquet NyxPolicies est une dépendance locale', () =>
    expect(readFileSync(resolve(PLUGIN, 'ios/Package.swift'), 'utf8')).toContain('.package(path: "NyxPolicies")'));

  // Credentials and Supabase tokens go through the secure store and its three commands: nothing
  // there may be logged (Tauri's Logger.info/error included).
  const LOGGING = /\bLogger\.|\bLogger\(|\bNSLog\b|\bprint\(|\bdump\(|\bos_log\b/;

  it('SecureStore.swift ne journalise rien', () => {
    const store = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxIosPlugin/SecureStore.swift'), 'utf8');
    expect(store).not.toMatch(LOGGING);
  });

  it('les commandes secure_* ne journalisent rien (clés et valeurs)', () => {
    const commands = swift.split(/@objc\s+public\s+func\s+/).filter((part) => /^secure(Get|Set|Delete)\(/.test(part));
    expect(commands).toHaveLength(3);
    for (const body of commands) expect(body).not.toMatch(LOGGING);
  });

  it('Keychain : service, accessibilité', () => {
    const store = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxIosPlugin/SecureStore.swift'), 'utf8');
    expect(store).toContain('"com.nyxplayer.app.secure"');
    expect(store).toContain('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly');
  });

  // The build script writes Tauri's Swift API to <plugin>/.tauri (Package.swift: ../.tauri/tauri-api).
  it('.tauri/ ignoré à la racine du plugin', () => {
    const gitignore = readFileSync(resolve(PLUGIN, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(gitignore).toContain('/.tauri');
  });

  it.each(['updateInfo', 'fetchUpdateManifest', 'requestInstallPermission', 'downloadUpdate', 'installUpdate'])(
    '%s refusé sur iOS', (name) =>
      expect(swift).toMatch(new RegExp(`func ${name}\\(_ invoke: Invoke\\)[^}]*invoke\\.reject\\("not supported on iOS"\\)`)));
});
