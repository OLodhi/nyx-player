// @vitest-environment node
// Android : la bibliothèque libmpv (AAR du fork kunai974/libmpv-android-lgpl) ne recopie pas les messages
// de mpv dans logcat. Ces messages citent l'adresse du flux (« [ffmpeg:v] Opening http://hôte/live/
// UTILISATEUR/MOTDEPASSE/1.ts »), donc les identifiants du compte IPTV : la version 0.41.0-2 les écrivait
// tels quels sous l'étiquette V/mpv, en debug comme en release. L'app les reçoit toujours par
// MPVLib.logMessage et les masque elle-même (StreamDiagnostics.redact) avant de les écrire.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const version = readFileSync(path.join(racine, 'src-tauri/plugins/tauri-plugin-nyx-android/android/build.gradle.kts'), 'utf8')
  .match(/"com\.nyxplayer:libmpv-lgpl:([^"]+)"/)?.[1];
const aar = path.join(
  racine,
  `src-tauri/plugins/tauri-plugin-nyx-android/android/libs/maven/com/nyxplayer/libmpv-lgpl/${version}/libmpv-lgpl-${version}.aar`,
);

/** Fichiers d'une archive zip (un AAR en est une), lus sans dépendance : répertoire central puis contenu. */
function lireZip(octets) {
  let fin = octets.length - 22;
  while (fin >= 0 && octets.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error('archive zip illisible');
  const total = octets.readUInt16LE(fin + 10);
  let pos = octets.readUInt32LE(fin + 16);
  const fichiers = new Map();
  for (let n = 0; n < total; n++) {
    if (octets.readUInt32LE(pos) !== 0x02014b50) throw new Error('répertoire central illisible');
    const methode = octets.readUInt16LE(pos + 10);
    const taille = octets.readUInt32LE(pos + 20);
    const longueurNom = octets.readUInt16LE(pos + 28);
    const local = octets.readUInt32LE(pos + 42);
    const nom = octets.subarray(pos + 46, pos + 46 + longueurNom).toString('utf8');
    pos += 46 + longueurNom + octets.readUInt16LE(pos + 30) + octets.readUInt16LE(pos + 32);
    const debut = local + 30 + octets.readUInt16LE(local + 26) + octets.readUInt16LE(local + 28);
    const brut = octets.subarray(debut, debut + taille);
    fichiers.set(nom, () => (methode === 0 ? brut : inflateRawSync(brut)));
  }
  return fichiers;
}

// Dépôt public : l'AAR n'est pas dans git (scripts/binaires-natifs.mjs le télécharge). Ici il l'est.
describe.skipIf(!existsSync(aar))('libmpv Android : rien de mpv recopié dans logcat', () => {
  const fichiers = existsSync(aar) ? lireZip(readFileSync(aar)) : new Map();
  const lecteurs = [...fichiers.keys()].filter((nom) => /^jni\/[^/]+\/libplayer\.so$/.test(nom));

  it('les quatre architectures sont présentes', () => {
    expect(lecteurs.sort()).toEqual(
      ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].map((abi) => `jni/${abi}/libplayer.so`),
    );
  });

  it.each(lecteurs)('%s ne contient plus le format « [préfixe:niveau] texte » de la recopie', (nom) => {
    const binaire = fichiers.get(nom)();
    // Témoin : c'est bien la couche JNI qui transmet les messages à l'app (sinon le test ne prouverait rien)
    expect(binaire.includes('mpv_request_log_messages')).toBe(true);
    expect(binaire.includes('logMessage')).toBe(true);
    expect(binaire.includes('[%s:%s] %s')).toBe(false);
  });
});
