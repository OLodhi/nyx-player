/**
 * thirdPartyLicenses.ts — Composants multimédia open source embarqués (écran « Licences open source »).
 *
 * Android : libmpv compilée en LGPL (fork kunai974/libmpv-android-lgpl : FFmpeg sans --enable-gpl,
 * mpv -Dgpl=false), bibliothèques partagées séparées et remplaçables dans l'APK.
 * Desktop : mpv.exe est un programme distinct piloté par IPC (build communautaire mpv-winbuild-cmake).
 *
 * À mettre à jour à chaque recompilation de libmpv (versions : buildscripts/include/depinfo.sh du fork)
 * ou changement de resources/mpv/mpv.exe (`mpv.exe --version`).
 */

export type LicensePlatform = 'android' | 'desktop';

export interface ThirdPartyComponent {
  name: string;
  version: string;
  /** Identifiant SPDX */
  license: string;
  /** Code source de la version exacte */
  sourceUrl: string;
  platforms: readonly LicensePlatform[];
  /** Affiché d'emblée ; les autres bibliothèques sont repliées (toujours accessibles) */
  primary?: boolean;
}

export const LIBMPV_BUILD_SOURCE = 'https://github.com/kunai974/libmpv-android-lgpl';

export const THIRD_PARTY_COMPONENTS: readonly ThirdPartyComponent[] = [
  // ── Android : libmpv (build LGPL) ──
  { name: 'mpv (libmpv)', version: '0.41.0', license: 'LGPL-2.1-or-later', sourceUrl: 'https://github.com/mpv-player/mpv/tree/v0.41.0', platforms: ['android'], primary: true },
  { name: 'FFmpeg', version: '9.0.1', license: 'LGPL-3.0-or-later', sourceUrl: 'https://github.com/FFmpeg/FFmpeg/tree/n9.0.1', platforms: ['android'], primary: true },
  { name: 'libplacebo', version: '7.360.1', license: 'LGPL-2.1-or-later', sourceUrl: 'https://code.videolan.org/videolan/libplacebo/-/tree/v7.360.1', platforms: ['android'] },
  { name: 'libass', version: '0.17.5', license: 'ISC', sourceUrl: 'https://github.com/libass/libass/tree/0.17.5', platforms: ['android'] },
  { name: 'FreeType', version: '2.14.3', license: 'FTL', sourceUrl: 'https://gitlab.freedesktop.org/freetype/freetype/-/tree/VER-2-14-3', platforms: ['android'] },
  { name: 'GNU FriBidi', version: '1.0.16', license: 'LGPL-2.1-or-later', sourceUrl: 'https://github.com/fribidi/fribidi/tree/v1.0.16', platforms: ['android'] },
  { name: 'HarfBuzz', version: '14.4.0', license: 'MIT', sourceUrl: 'https://github.com/harfbuzz/harfbuzz/tree/14.4.0', platforms: ['android'] },
  { name: 'Fontconfig', version: '2.18.3', license: 'HPND', sourceUrl: 'https://gitlab.freedesktop.org/fontconfig/fontconfig/-/tree/2.18.3', platforms: ['android'] },
  { name: 'libxml2', version: '2.15.4', license: 'MIT', sourceUrl: 'https://gitlab.gnome.org/GNOME/libxml2/-/tree/v2.15.4', platforms: ['android'] },
  { name: 'dav1d', version: '1.5.4', license: 'BSD-2-Clause', sourceUrl: 'https://code.videolan.org/videolan/dav1d/-/tree/1.5.4', platforms: ['android'] },
  { name: 'Mbed TLS', version: '3.6.7', license: 'Apache-2.0', sourceUrl: 'https://github.com/Mbed-TLS/mbedtls/tree/v3.6.7', platforms: ['android'] },
  { name: 'libunibreak', version: '7.0', license: 'Zlib', sourceUrl: 'https://github.com/adah1972/libunibreak/releases/tag/libunibreak_7_0', platforms: ['android'] },
  { name: 'LLVM libc++', version: 'NDK r30', license: 'Apache-2.0 WITH LLVM-exception', sourceUrl: 'https://github.com/llvm/llvm-project', platforms: ['android'] },

  // ── Desktop : mpv.exe (programme séparé) ──
  { name: 'mpv (mpv.exe)', version: '0.41.0-35-gc0d989c83', license: 'GPL-3.0-or-later', sourceUrl: 'https://github.com/mpv-player/mpv/commit/c0d989c83', platforms: ['desktop'], primary: true },
  { name: 'FFmpeg (dans mpv.exe)', version: 'N-122267-gabb152413', license: 'GPL-3.0-or-later', sourceUrl: 'https://github.com/FFmpeg/FFmpeg/commit/abb152413', platforms: ['desktop'], primary: true },
  { name: 'mpv-winbuild-cmake (recette de compilation)', version: '—', license: 'GPL-3.0-or-later', sourceUrl: 'https://github.com/shinchiro/mpv-winbuild-cmake', platforms: ['desktop'], primary: true },
];

export function componentsFor(platform: LicensePlatform): ThirdPartyComponent[] {
  return THIRD_PARTY_COMPONENTS.filter((c) => c.platforms.includes(platform));
}
