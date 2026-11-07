/**
 * iOS: the nyx-android plugin is registered on iOS with its Swift package (same JS name as on
 * Android). The Swift build itself runs in .github/workflows/ios.yml; this checks the wiring text.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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

  // GnuTLS (MPVKit's FFmpeg) can't read iOS's own roots: the plugin ships Mozilla's list from
  // webpki-root-certs (Rust, iOS only) and writes it as a PEM file for mpv's tls-ca-file.
  it('certificats racine pour iOS seulement', () => {
    const cargo = readFileSync(resolve(PLUGIN, 'Cargo.toml'), 'utf8');
    const iosDeps = /\[target\.'cfg\(target_os = "ios"\)'\.dependencies\]([\s\S]*?)(\n\[|$)/.exec(cargo)?.[1] ?? '';
    expect(iosDeps).toMatch(/^webpki-root-certs\s*=/m);
    expect(cargo.replace(iosDeps, '')).not.toContain('webpki-root-certs');
    expect(libRs).toMatch(/#\[cfg\(target_os = "ios"\)\]\s*mod ios_ca;/);
  });

  it('fichier CA écrit de façon atomique', () => {
    const ca = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxIosPlugin/CaBundle.swift'), 'utf8');
    expect(ca).toContain('nyx-cacert.pem.tmp');
    expect(ca).toMatch(/replaceItemAt|moveItem/);
    // Rust's extern "C" functions are reached through a C header (C calling convention), not
    // @_silgen_name (Swift's)
    expect(ca).toContain('import NyxRustExports');
    const header = readFileSync(resolve(PLUGIN, 'ios/Sources/NyxRustExports/nyx_rust_exports.h'), 'utf8');
    expect(header).toContain('size_t nyx_ios_root_cert_count(void);');
    expect(header).toContain('const unsigned char *nyx_ios_root_cert(size_t index, size_t *len);');
    const rust = readFileSync(resolve(PLUGIN, 'src/ios_ca.rs'), 'utf8');
    expect(rust).toMatch(/#\[no_mangle\]\s*pub extern "C" fn nyx_ios_root_cert_count\(\) -> usize/);
    expect(rust).toMatch(/#\[no_mangle\]\s*pub unsafe extern "C" fn nyx_ios_root_cert\(index: usize, len: \*mut usize\) -> \*const u8/);
  });

  // Like Android phones: portrait outside the player, set by the plugin when it loads
  it('verrou portrait au chargement', () => {
    const load = /override func load\(webview: WKWebView\) \{([\s\S]*?)\r?\n {4}\}/.exec(swift)?.[1] ?? '';
    expect(load).toContain('applyEverydayLock()');
  });

  // The page waits for this property after every set_fullscreen, changed or not (Android does the same)
  it('set_fullscreen émet toujours la propriété fullscreen', () => {
    const body = swift.split(/@objc\s+public\s+func\s+/).find((part) => part.startsWith('setFullscreen(')) ?? '';
    expect(body).toMatch(/trigger\("property", data: \["name": "fullscreen", "data": enabled\]/);
  });

  // MoltenVK's video thread hops to main; a main thread blocked on it would deadlock
  it('aucun DispatchQueue.main.sync dans le plugin', () => {
    const dir = resolve(PLUGIN, 'ios/Sources');
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.swift'));
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(resolve(dir, f), 'utf8'), f).not.toMatch(/DispatchQueue\.main\.sync/);
  });

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
