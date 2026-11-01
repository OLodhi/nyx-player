// Binaires natifs que le dépôt public ne contient pas (trop lourds pour git) : mpv.exe pour Windows et
// la bibliothèque libmpv (AAR) pour Android. Ce script les télécharge depuis la « release » GitHub des
// dépendances natives et vérifie leur empreinte SHA-256 avant de les poser à leur place.
//
// Usage : node scripts/binaires-natifs.mjs [windows|android|tout]   (défaut : tout)
// Un fichier déjà présent avec la bonne empreinte n'est pas retéléchargé ; une mauvaise empreinte
// arrête le script sans rien remplacer.
//
// Vérification seule, sans rien télécharger : node scripts/binaires-natifs.mjs windows --verifier
// (code 1 si un binaire manque, est un pointeur Git LFS ou n'a pas la bonne empreinte). Appelée par
// scripts/windows-release.ps1 avant la compilation, et par vite.config.ts pour toute compilation Windows
// (scripts/garde-publication.mjs) : une copie du dépôt sans le contenu Git LFS embarquait sinon un
// mpv.exe de 134 octets, que Windows refuse à la lecture (« Application 16 bits non prise en charge »).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = 'https://github.com/kunai974/nyx-player/releases/download/native-deps-1';

/** Origine, version et licence : resources/mpv/README.md et le README du dossier libs d'Android. */
export const BINAIRES = [
  {
    cible: 'windows',
    nom: 'mpv.exe',
    destination: 'resources/mpv/mpv.exe',
    sha256: 'b8e6ce5ec94f2ab3b7e3ec851d6ffe6f5761962dcb7282bf985b9ffe6a0dccba',
  },
  {
    cible: 'android',
    nom: 'libmpv-lgpl-0.41.0-3.aar',
    destination: 'src-tauri/plugins/tauri-plugin-nyx-android/android/libs/maven/com/nyxplayer/libmpv-lgpl/0.41.0-3/libmpv-lgpl-0.41.0-3.aar',
    sha256: 'f5e44d6e4f6fb3db3785d088f4c2728e59d26b5642b8271a4717c19ebaa8a7ab',
  },
];

export const empreinte = (contenu) => createHash('sha256').update(contenu).digest('hex');

const estPresent = (fichier, sha256) => existsSync(fichier) && empreinte(readFileSync(fichier)) === sha256;

/** Pointeur Git LFS non résolu (petit fichier texte suivi par git) : le remplacer ferait apparaître le
 *  binaire comme une modification à commiter. C'est `git lfs pull` qu'il faut alors. */
const estPointeurLfs = (fichier) =>
  existsSync(fichier) && readFileSync(fichier).subarray(0, 64).toString('latin1').startsWith('version https://git-lfs');

/** Délai maximal d'un téléchargement (le plus gros fichier fait environ 110 Mo). */
const DELAI_MS = 15 * 60 * 1000;

/** Taille sous laquelle un binaire embarqué ne peut être le vrai (mpv.exe : environ 110 Mo). */
const TAILLE_MIN = 1024 * 1024;

/**
 * Problèmes des binaires d'une cible, tels qu'ils sont sur le disque (rien n'est téléchargé) : absent,
 * pointeur Git LFS, trop petit, empreinte inattendue. Liste vide si tout est bon. Chaque message, en
 * français, dit quoi faire.
 */
export function problemesBinaires(cible, racine = RACINE, binaires = BINAIRES) {
  const problemes = [];
  const remede = 'lancer « git lfs pull » à la racine du dépôt, puis recommencer';
  for (const b of binaires.filter((x) => x.cible === cible)) {
    const fichier = path.join(racine, b.destination);
    if (!existsSync(fichier)) {
      problemes.push(`${b.destination} introuvable : lancer « node scripts/binaires-natifs.mjs ${cible} » (ou « git lfs pull » dans un dépôt qui le garde par Git LFS), puis recommencer.`);
      continue;
    }
    const taille = statSync(fichier).size;
    if (estPointeurLfs(fichier)) {
      problemes.push(`${b.destination} n'est pas le vrai programme mais un pointeur Git LFS de ${taille} octets (copie du dépôt sans le contenu Git LFS) : ${remede}.`);
    } else if (taille < TAILLE_MIN) {
      problemes.push(`${b.destination} est trop petit pour être le vrai programme (${taille} octets) : ${remede}.`);
    } else if (empreinte(readFileSync(fichier)) !== b.sha256) {
      problemes.push(`${b.destination} a une empreinte inattendue (attendue ${b.sha256}) : ${remede}. S'il vient d'être mis à jour, changer aussi son empreinte dans scripts/binaires-natifs.mjs.`);
    }
  }
  return problemes;
}

async function telecharger(binaire) {
  const fichier = path.join(RACINE, binaire.destination);
  if (estPresent(fichier, binaire.sha256)) {
    console.log(`${binaire.nom} : déjà en place, empreinte vérifiée.`);
    return;
  }
  if (estPointeurLfs(fichier)) {
    throw new Error(`${binaire.destination} est un pointeur Git LFS : lancer « git lfs pull » au lieu de ce script`);
  }
  console.log(`${binaire.nom} : téléchargement…`);
  const reponse = await fetch(`${RELEASE}/${binaire.nom}`, { signal: AbortSignal.timeout(DELAI_MS) });
  if (!reponse.ok) throw new Error(`${binaire.nom} : réponse ${reponse.status} de GitHub`);
  const contenu = Buffer.from(await reponse.arrayBuffer());
  const recue = empreinte(contenu);
  if (recue !== binaire.sha256) {
    throw new Error(`${binaire.nom} : empreinte inattendue (${recue}), fichier refusé`);
  }
  mkdirSync(path.dirname(fichier), { recursive: true });
  const provisoire = `${fichier}.part`;
  try {
    writeFileSync(provisoire, contenu);
    rmSync(fichier, { force: true });
    renameSync(provisoire, fichier);
  } finally {
    rmSync(provisoire, { force: true });
  }
  console.log(`${binaire.nom} : posé dans ${binaire.destination}, empreinte vérifiée.`);
}

const lancéDirectement = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (lancéDirectement) {
  // --racine <dossier> : copie du dépôt à vérifier (tests seulement) ; par défaut, celle de ce script
  const args = process.argv.slice(2);
  const verifier = args.includes('--verifier');
  const iRacine = args.indexOf('--racine');
  const racine = iRacine >= 0 ? args[iRacine + 1] : RACINE;
  const restants = args.filter((a, i) => a !== '--verifier' && i !== iRacine && (iRacine < 0 || i !== iRacine + 1));
  const choix = restants[0] ?? 'tout';
  if (!['windows', 'android', 'tout'].includes(choix) || restants.length > 1 || !racine || (iRacine >= 0 && !verifier)) {
    console.error('Usage : node scripts/binaires-natifs.mjs [windows|android|tout] [--verifier [--racine <dossier>]]');
    process.exit(2);
  }
  if (verifier) {
    const cibles = choix === 'tout' ? ['windows', 'android'] : [choix];
    const problemes = cibles.flatMap((c) => problemesBinaires(c, racine));
    for (const p of problemes) console.error(p);
    if (problemes.length === 0) console.log('Binaires natifs en place, empreintes vérifiées.');
    process.exit(problemes.length === 0 ? 0 : 1);
  }
  try {
    for (const b of BINAIRES) if (choix === 'tout' || b.cible === choix) await telecharger(b);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
