# Building Nyx Player from source

Nyx Player is one codebase for three targets: Windows (desktop), Android phones and Android TV (the
same APK). The interface is React + TypeScript + Vite, the native core is Tauri 2 (Rust), and video
goes through mpv: `mpv.exe` on Windows, a native LGPL build of libmpv on Android.

## 1. Common requirements

| Tool | Version |
|---|---|
| [Node.js](https://nodejs.org/) | 20.19+ or 22.12+, 22.12+ recommended (Vite needs one of these; the Supabase packages ask for 22 and only warn on 20) |
| [pnpm](https://pnpm.io/) | 10 (the exact version is in `package.json`, `packageManager`) |
| [Rust](https://rustup.rs/) | stable |
| Git | any recent version |

```sh
git clone https://github.com/kunai974/nyx-player.git
cd nyx-player
pnpm install
pnpm verify        # type check, tests, ESLint, CSS rules and web build
```

`pnpm dev` starts the interface alone in a browser (no native features, no playback). It is enough
for most interface work.

### Configuration

Copy `.env.example` to `.env`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required: the
app signs in to a Nyx account (Supabase) before anything else. Use the address and **publishable**
key of your own [Supabase](https://supabase.com/) project; the database schema it needs is not
published in this repository yet. With placeholder values (`https://example.invalid`, as the CI
does), the tests and the web build run, and the app stops at the sign-in screen. `VITE_SENTRY_DSN`
(crash reports) is optional. Never put a secret key in `.env`: the variables starting with `VITE_`
end up in the app.

## 2. Native binaries (not stored in git)

Two binaries are too large for the repository. They are published as assets of the
[`native-deps-1` release](https://github.com/kunai974/nyx-player/releases/tag/native-deps-1) and
fetched by a script that checks their SHA-256 fingerprint before putting them in place:

```sh
node scripts/binaires-natifs.mjs windows   # resources/mpv/mpv.exe (Windows player)
node scripts/binaires-natifs.mjs android   # libmpv AAR for the Android plugin
node scripts/binaires-natifs.mjs           # both
```

| File | Origin | Licence |
|---|---|---|
| `mpv.exe` | [mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) build of mpv with FFmpeg (versions in `src/data/thirdPartyLicenses.ts`) | GPL-3.0-or-later |
| `libmpv-lgpl-0.41.0-3.aar` | [libmpv-android-lgpl](https://github.com/kunai974/libmpv-android-lgpl), mpv built with `-Dgpl=false` and FFmpeg without `--enable-gpl` | LGPL |

The Rust build also needs `resources/mpv/mpv.exe` to exist on every system (Tauri checks the
declared resources), so run the `windows` step once on any system before `cargo test`.

## 3. Windows desktop app

Requirements: the [Tauri 2 Windows prerequisites](https://v2.tauri.app/start/prerequisites/)
(Microsoft C++ Build Tools and WebView2, already present on Windows 10 and 11).

```sh
node scripts/binaires-natifs.mjs windows
pnpm tauri dev      # development app with hot reload
pnpm tauri build    # installer in src-tauri/target/release/bundle/
```

Rust tests: `cargo test --locked` in `src-tauri/`.

## 4. Android (phone and TV)

Requirements: the [Tauri 2 Android prerequisites](https://v2.tauri.app/start/prerequisites/):
Android SDK (platform 36), NDK, JDK 17, and the Rust targets:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi
node scripts/binaires-natifs.mjs android
```

Then, on Linux or macOS:

```sh
pnpm tauri android build --apk --split-per-abi --target aarch64   # recent phones (64-bit)
pnpm tauri android build --apk --split-per-abi --target armv7     # Android TV / Chromecast (32-bit)
```

On Windows, use `./scripts/android.ps1` with the same arguments (for example
`./scripts/android.ps1 build --apk --split-per-abi --target armv7`): it sets up the C toolchain
variables some crates need and a private temporary folder for Tauri.

The APKs land in `src-tauri/gen/android/app/build/outputs/apk/`. They are unsigned: sign them with
your own debug key (`apksigner`) before installing with `adb install -r <file.apk>`. Android 8.0
(API 26) or later is required.

The same APK chooses its interface at start-up: touch on a phone, remote control on Android TV.

Kotlin tests of the Android plugin (player logic, no device needed), after a first build:

```sh
cd src-tauri/gen/android
./gradlew :tauri-plugin-nyx-android:testDebugUnitTest
```

## 5. Before opening a pull request

- `pnpm verify` must pass.
- For Rust changes: `cargo test --locked` in `src-tauri/`.
- Read [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the code conventions in
  [`docs/CONVENTIONS.md`](CONVENTIONS.md).

## 6. How official releases are built

Official releases are not built on a maintainer's computer. Pushing a version tag (`v0.8.0`) on
`main` starts [`.github/workflows/release.yml`](../.github/workflows/release.yml) on GitHub Actions:

1. it checks that the tag matches the version in `tauri.conf.json`, `Cargo.toml` and `package.json`;
2. it builds the Windows installer and the two Android APKs from that exact commit, without any
   signing key;
3. only then, in separate steps, it signs them. The keys live in GitHub's encrypted secrets, in a
   `publication` environment that only accepts version tags and waits for the maintainer's approval;
4. it checks every signature (the update key the apps trust, the APK certificate below, the app id);
5. it issues a signed build provenance attestation for every file and prepares a draft release with
   the files, `SHA256SUMS.txt` and the update manifests (`latest.json`, `android.json`).

The same files are then served, unchanged, from `https://releases.nyxplayer.app/`. Anyone can check a
download:

```sh
gh attestation verify nyx-player-arm64-v0.8.0.apk --repo kunai974/nyx-player
sha256sum -c SHA256SUMS.txt
apksigner verify --print-certs nyx-player-arm64-v0.8.0.apk
# certificate SHA-256: acf30887eaecc988bc9cf59217c3d54a6d79e78f0e090a49eb481a7c504a9d28
```

The Windows update public key is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
