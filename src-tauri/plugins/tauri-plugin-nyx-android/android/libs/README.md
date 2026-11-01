# libmpv — build LGPL embarqué

`com.nyxplayer:libmpv-lgpl:0.41.0-3` (dépôt Maven local, résolu par `../build.gradle.kts`).

| | |
|---|---|
| Source | https://github.com/kunai974/libmpv-android-lgpl (commit `a6bce1d`) |
| Compilation | GitHub Actions run 41195952861 — https://github.com/kunai974/libmpv-android-lgpl/actions/runs/41195952861 |
| Téléchargement | release `aar-0.41.0-3` du fork — https://github.com/kunai974/libmpv-android-lgpl/releases/tag/aar-0.41.0-3 (le même fichier doit aussi être déposé dans la release `native-deps-1` du dépôt public, d'où `scripts/binaires-natifs.mjs` le télécharge) |
| Contenu | mpv 0.41.0 (`-Dgpl=false`, LGPL-2.1+, sans Lua), FFmpeg 9.0.1 (`--enable-version3` sans `--enable-gpl`, LGPL-3.0+), ABIs arm64-v8a / armeabi-v7a / x86 / x86_64 |
| SHA-256 | `f5e44d6e4f6fb3db3785d088f4c2728e59d26b5642b8271a4717c19ebaa8a7ab` |

Vérifié : `libavcodec.so` contient « LGPL version 3 or later » et pas `--enable-gpl`, `libmpv.so` contient `-Dgpl=false` et `-Dlua=disabled`.
La couche JNI (`libplayer.so`) ne recopie plus les messages de mpv dans logcat : ils citent l'adresse du
flux, donc les identifiants IPTV (`scripts/test/libmpv-journal.test.mjs`). L'app les reçoit toujours par
`MPVLib.logMessage` et les masque elle-même (`StreamDiagnostics.redact`).

Historique :
- `0.41.0-2` (run 35023196386, commit `fac0cb4`) recopiait chaque message de mpv sous l'étiquette `V/mpv`,
  adresse complète du flux comprise, en debug comme en release.
- `0.41.0-1` (run 35013435497, commit `3036a70`) incluait Lua, inutilisé par l'app.

Mise à jour : relancer le workflow « Build libmpv-android » du fork (envoi sur `main`), puis « Release AAR » avec le numéro du
run et l'étiquette `aar-0.x.y-n` ; remplacer l'AAR (nouvelle version `0.x.y-n`), mettre à jour
`scripts/binaires-natifs.mjs` (et déposer le fichier dans `native-deps-1`) et `src/data/thirdPartyLicenses.ts`, retester la lecture.
