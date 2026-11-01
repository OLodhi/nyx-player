# mpv.exe — lecteur vidéo de l'app Windows

Programme séparé, lancé par l'app Windows pour lire les vidéos (`src-tauri/src/playback.rs`). Trop lourd
pour git : téléchargé par `node scripts/binaires-natifs.mjs windows` depuis la release `native-deps-1`
du dépôt, empreinte vérifiée avant de le poser ici (voir `docs/BUILDING.md`).

| | |
|---|---|
| Recette de compilation | [mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) |
| mpv | `0.41.0-35-gc0d989c83` (commit [`c0d989c83`](https://github.com/mpv-player/mpv/commit/c0d989c83)) |
| FFmpeg | `N-122267-gabb152413` (commit [`abb152413`](https://github.com/FFmpeg/FFmpeg/commit/abb152413)) |
| Licence | GPL-3.0-or-later |
| Taille | 115 844 096 octets |
| SHA-256 | `b8e6ce5ec94f2ab3b7e3ec851d6ffe6f5761962dcb7282bf985b9ffe6a0dccba` |

Sources correspondantes (GPL-3.0, §6) : les commits ci-dessus de mpv et de FFmpeg, et la recette de
compilation. Chaque release qui distribue `mpv.exe` joint une archive de ces sources.

Mise à jour : compiler la nouvelle version, publier `mpv.exe` dans une nouvelle release de dépendances
natives, puis changer ici, dans `scripts/binaires-natifs.mjs` (empreinte) et dans
`src/data/thirdPartyLicenses.ts` (versions) dans la même PR.
