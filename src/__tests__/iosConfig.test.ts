/**
 * iOS: the bundle config merged over tauri.conf.json, and the Info.plist keys merged into the
 * generated Xcode project. No mpv.exe or updater on iOS, nothing personal committed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_TAURI = resolve(__dirname, '../../src-tauri');
const GEN_APPLE = resolve(SRC_TAURI, 'gen/apple');

describe('configuration iOS', () => {
  const raw = readFileSync(resolve(SRC_TAURI, 'tauri.ios.conf.json'), 'utf8');
  const conf = JSON.parse(raw);
  const plist = readFileSync(resolve(SRC_TAURI, 'Info.ios.plist'), 'utf8');
  const plistArray = (key: string): string[] =>
    [...(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1] ?? '')
      .matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);

  it('ne fournit pas mpv.exe ni le module de mise à jour', () => {
    expect(conf.bundle.resources).toBeNull();
    expect(conf.bundle.createUpdaterArtifacts).toBe(false);
    expect(conf.plugins.updater).toBeNull();
  });

  it('iOS 15 minimum (MPVKit)', () => expect(conf.bundle.iOS.minimumSystemVersion).toBe('15.0'));

  it('aucune équipe Apple ni identifiant personnel', () => {
    expect(raw).not.toContain('developmentTeam');
    expect(conf.identifier).toBeUndefined();
  });

  it('lecture audio en arrière-plan déclarée', () => expect(plistArray('UIBackgroundModes')).toEqual(['audio']));

  it('http permis pour les logos et affiches, une seule clé ATS', () => {
    expect(plist).toMatch(/<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/);
    expect(plist).not.toMatch(/NSAllowsArbitraryLoadsInWebContent|NSAllowsArbitraryLoadsForMedia/);
  });

  // The iPhone lists landscape for the player, but the plugin locks portrait at start-up (like
  // Android phones, DevicePolicy.locksPortrait: no landscape layout outside the player) and unlocks
  // landscape only for playback. Tablets keep every orientation.
  it('iPhone : portrait et paysage dans Info.plist, verrou portrait à l’exécution ; iPad : tout', () => {
    expect(plistArray('UISupportedInterfaceOrientations')).toEqual([
      'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight']);
    expect(plistArray('UISupportedInterfaceOrientations~ipad')).toHaveLength(4);
  });
});

// tauri-cli rewrites project.pbxproj and ExportOptions.plist on each `ios dev`/`ios build` with a
// team or a `--config` identifier: a build on a Mac must not leave anything personal committed.
describe('projet Xcode généré (gen/apple)', () => {
  const files = (readdirSync(GEN_APPLE, { recursive: true }) as string[])
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => !/^(build|Externals)\/|xcuserdata\/|\.png$/.test(f))
    .filter((f) => /\.(pbxproj|plist|yml|xcscheme|entitlements|xcsettings|xcworkspacedata|json|storyboard|h|mm)$|Podfile$/.test(f));
  const text = (f: string) => readFileSync(resolve(GEN_APPLE, f), 'utf8');

  it('trouve les fichiers du projet', () => {
    expect(files).toContain('nyxplayer.xcodeproj/project.pbxproj');
    expect(files).toContain('ExportOptions.plist');
  });

  it('aucune équipe Apple', () => {
    for (const f of files) expect(text(f), f).not.toMatch(/DEVELOPMENT_TEAM|teamID|DevelopmentTeam/);
  });

  it('identifiant de bundle : toujours com.nyxplayer.app', () => {
    const ids = files.flatMap((f) =>
      [...text(f).matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*[=:]\s*"?([^";\s]+)"?/g)].map((m) => `${f}: ${m[1]}`));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/: (com\.nyxplayer\.app|\$\(PRODUCT_BUNDLE_IDENTIFIER\))$/);
  });
});

describe('workflow iOS', () => {
  const yml = readFileSync(resolve(__dirname, '../../.github/workflows/ios.yml'), 'utf8').replace(/\r\n/g, '\n');

  // A fork can add the public Supabase values as secrets to get an IPA that signs in (as android.yml)
  it('seuls les secrets Supabase, avec repli sur les valeurs fictives (comme android.yml)', () => {
    expect([...yml.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL']);
    expect(yml).toContain("secrets.VITE_SUPABASE_URL || 'https://example.invalid'");
    expect(yml).toContain("secrets.VITE_SUPABASE_ANON_KEY || 'ci-placeholder'");
  });

  it('tests Swift de NyxPolicies', () =>
    expect(yml).toContain('swift test --package-path src-tauri/plugins/tauri-plugin-nyx-android/ios/NyxPolicies'));

  // A failed build or launch must not hide the Swift rules' results (only a cancelled run skips them)
  it('les tests Swift tournent même après l’échec d’une construction ou du lancement', () =>
    expect(yml).toMatch(/- name: Swift unit tests \(NyxPolicies\)\n {8}if: \$\{\{ !cancelled\(\) \}\}\n {8}run: swift test /));

  it('le commentaire sur `pnpm build` est juste au-dessus de la construction de l’IPA', () =>
    expect(yml).toMatch(/\n {6}# Also runs `pnpm build` \(web UI\) before Xcode compiles the Rust and Swift code\.\n {6}- name: Build the unsigned IPA\n/));

  it('vérifie que le processus lancé tourne encore (PID), pas une entrée de launchctl', () => {
    expect(yml).toMatch(/kill -0 "\$pid"/);
    expect(yml).not.toContain('launchctl list');
  });

  it('IPA non signée, Xcode 26', () => {
    expect(yml).toContain('tauri ios build --ci --target aarch64 --no-sign');
    expect(yml).toMatch(/Xcode_26/);
  });

  it('vérifie que Info.ios.plist est bien fusionné', () => expect(yml).toContain('plutil -extract UIBackgroundModes'));

  // The generated Info.plist allows landscape on iPhone; only the merge of Info.ios.plist removes it
  it('vérifie l’orientation dans l’app construite', () => {
    expect(yml).toContain(`plutil -extract UISupportedInterfaceOrientations json -o - "$app/Info.plist"`);
    expect(yml).toContain(`'["UIInterfaceOrientationPortrait","UIInterfaceOrientationLandscapeLeft","UIInterfaceOrientationLandscapeRight"]'`);
  });

  // Spike S3 in CI: a debug-only hook puts a plain view under the page, makes the page transparent,
  // enters fullscreen and writes what UIKit reports (orientation, bars, view order) to a JSON file
  it('contrôle S3 : vue sous la page, plein écran paysage, barres masquées', () => {
    expect(yml).toContain('SIMCTL_CHILD_NYX_SPIKE_S3=1 xcrun simctl launch');
    expect(yml).toMatch(/jq -e '\.orientation == "landscapeLeft" or \.orientation == "landscapeRight"'/);
    expect(yml).toMatch(/jq -e '\.statusBarHidden == true and \.homeIndicatorAutoHidden == true and \.videoBelowWebView == true'/);
    expect(yml).toMatch(/jq -e '\.orientation == "portrait" and \.statusBarHidden == false'/);
  });

  // Playback smoke in CI: a clip made on the CI Mac, served on its loopback (never a real stream),
  // played by a debug-only hook through the libmpv engine, which writes what it saw to a JSON file
  it('fumée lecture : clip local servi sur la machine, temps qui avance, liste CA présente', () => {
    expect(yml).toContain('ffmpeg -f lavfi');
    expect(yml).toContain('python3 -m http.server');
    expect(yml).toContain('--bind 127.0.0.1');
    expect(yml).toContain('SIMCTL_CHILD_NYX_SMOKE_PLAY=http://127.0.0.1:8765/clip.mp4');
    expect(yml).toMatch(/jq -e '\.timePos > 2'/);
    expect(yml).toMatch(/jq -e '\.ca\.count >= 100'/);
    expect(yml).toMatch(/jq -e '\.errors == \[\]'/);
    expect(yml).toContain('smoke-playing.png');
  });

  // The hook writes its result once the clip has played 5 s: CI waits for that file (startup in the
  // Simulator takes several seconds), then takes the screenshot while the clip is still playing
  it('fumée lecture : attend le résultat, puis la capture pendant la lecture', () => {
    const wait = yml.indexOf('for _ in $(seq 1 60); do test -f "$result" && break; sleep 1; done');
    expect(wait).toBeGreaterThan(-1);
    expect(yml.indexOf('screenshot smoke-playing.png')).toBeGreaterThan(wait);
  });

  // Xcode's archive leaves an incomplete .app in DerivedData: pick the complete one built for the Simulator
  it('choisit l’app du Simulateur par sa plateforme, pas par son dossier', () =>
    expect(yml).toMatch(/CFBundleSupportedPlatforms[\s\S]*iPhoneSimulator/));

  it('ne part jamais tout seul sur le dépôt public', () =>
    expect(yml).not.toContain("github.repository == 'kunai974/nyx-player'"));
});
