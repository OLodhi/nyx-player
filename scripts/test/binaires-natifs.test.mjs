// @vitest-environment node
// Binaires natifs téléchargés par scripts/binaires-natifs.mjs : chaque destination est bien celle que
// la compilation lit, et l'empreinte attendue est celle que documente le dossier de la bibliothèque.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BINAIRES, empreinte } from '../binaires-natifs.mjs';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const lire = (relatif) => readFileSync(path.join(racine, relatif), 'utf8');
const binaire = (cible) => BINAIRES.find((b) => b.cible === cible);

describe('binaires natifs hors de git', () => {
  it('mpv.exe arrive là où Tauri le déclare comme ressource', () => {
    const ressources = JSON.parse(lire('src-tauri/tauri.conf.json')).bundle.resources;
    expect(Object.keys(ressources).map((r) => path.posix.normalize(`src-tauri/${r}`))).toContain(binaire('windows').destination);
  });

  it('libmpv arrive dans le dépôt Maven local, à la version que Gradle demande', () => {
    const version = lire('src-tauri/plugins/tauri-plugin-nyx-android/android/build.gradle.kts')
      .match(/"com\.nyxplayer:libmpv-lgpl:([^"]+)"/)?.[1];
    expect(version).toBeTruthy();
    expect(binaire('android').destination).toBe(
      `src-tauri/plugins/tauri-plugin-nyx-android/android/libs/maven/com/nyxplayer/libmpv-lgpl/${version}/libmpv-lgpl-${version}.aar`,
    );
    expect(binaire('android').nom).toBe(`libmpv-lgpl-${version}.aar`);
  });

  it('empreinte de libmpv : la même que dans le README de la bibliothèque', () => {
    expect(lire('src-tauri/plugins/tauri-plugin-nyx-android/android/libs/README.md')).toContain(binaire('android').sha256);
  });

  // Dans un dépôt qui garde mpv.exe par Git LFS, le fichier extrait sans LFS est un pointeur texte
  // qui porte l'empreinte du vrai binaire : elle doit être celle que le script attend.
  const pointeur = path.join(racine, 'resources/mpv/mpv.exe');
  const oid = existsSync(pointeur) && statSync(pointeur).size < 1024 ? readFileSync(pointeur, 'latin1').match(/^oid sha256:([0-9a-f]{64})$/m)?.[1] : undefined;
  it.skipIf(!oid)('empreinte de mpv.exe : la même que celle du pointeur Git LFS', () => {
    expect(binaire('windows').sha256).toBe(oid);
  });

  it.skipIf(!oid)('un pointeur Git LFS n\'est pas remplacé : le script demande « git lfs pull »', () => {
    const r = spawnSync(process.execPath, [path.join(racine, 'scripts/binaires-natifs.mjs'), 'windows'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('git lfs pull');
    expect(readFileSync(pointeur, 'latin1')).toContain(`oid sha256:${oid}`);
  });

  it('empreinte SHA-256 en hexadécimal minuscule', () => {
    expect(empreinte(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const b of BINAIRES) expect(b.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
