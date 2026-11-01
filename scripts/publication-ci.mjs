// Contrôles et fichiers de la publication fabriquée sur GitHub (.github/workflows/release.yml).
// Mêmes règles que les scripts de publication du PC (scripts/windows-release.ps1,
// scripts/android-release-apk.ps1), réécrites en Node pour tourner sur les machines Linux et Windows de
// GitHub. Aucune commande ne lit ni n'écrit une clé privée : elles ne voient que des fichiers publics
// (signature .sig, APK signés, fichiers de version).
//
// Usage (depuis la racine du dépôt) :
//   node scripts/publication-ci.mjs version <étiquette>            vérifie v<X.Y.Z> = les 3 numéros, écrit la version
//   node scripts/publication-ci.mjs notes <version>                écrit le texte court de latest.json
//   node scripts/publication-ci.mjs corps <version>                écrit le texte de la page de la release
//   node scripts/publication-ci.mjs signature-windows <.sig> <version>
//   node scripts/publication-ci.mjs apk <fichier.apk>              bonne app, bonne clé (apksigner, aapt2)
//   node scripts/publication-ci.mjs variables                      refuse une variable du banc ou d'audit
//   node scripts/publication-ci.mjs manifestes <dossier> <version> écrit latest.json, android.json, SHA256SUMS.txt
// Code de sortie 1 et message en français si un contrôle échoue : rien ne doit être publié.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Début du nom de l'installeur signé (productName + « _ ») : INSTALLER_PREFIX de src-tauri/src/app_update.rs. */
export const PREFIXE_INSTALLEUR = 'Nyx Player_';
/** Empreinte SHA-256 du certificat de la clé des APK (publique) : la même que scripts/android-release-apk.ps1. */
export const EMPREINTE_APK = 'AC:F3:08:87:EA:EC:C9:88:BC:9C:F5:92:17:C3:D5:4A:6D:79:E7:8F:0E:09:0A:49:EB:48:1A:7C:50:4A:9D:28';
/** Nom interne de la vraie app : un APK du banc ou de mesure ne se publie jamais. */
export const PAQUET_APK = 'com.nyxplayer.app';
/** Adresse publique des fichiers (R2), seule acceptée par les apps pour un APK. */
export const ADRESSE_FICHIERS = 'https://releases.nyxplayer.app/';
/** Variables qui changent le contenu de la version compilée : même liste que les scripts du PC. */
export const VARIABLES_INTERDITES = ['NYX_ANDROID_APP_ID', 'NYX_ANDROID_APP_LABEL', 'NYX_VERSION_AUDIT',
  'VITE_AUDIT', 'VITE_BANC', 'VITE_BANC_LECTEUR', 'VITE_AUDIT_BUILD', 'VITE_PERF'];
/** Les deux APK publiés : dossier de sortie de Gradle → nom public. */
export const APK = [
  { dossier: 'arm64', nom: 'arm64' },
  { dossier: 'arm', nom: 'armv7' },
];

export const nomInstalleur = (version) => `Nyx-Player_${version}_x64-setup.exe`;
export const nomApk = (nom, version) => `nyx-player-${nom}-v${version}.apk`;

class ErreurPublication extends Error {}
const refuser = (message) => { throw new ErreurPublication(message); };

const lire = (racine, relatif) => readFileSync(path.join(racine, relatif), 'utf8');

/** Les trois numéros de version du dépôt. */
export function versionsDuDepot(racine = RACINE) {
  return {
    tauri: JSON.parse(lire(racine, 'src-tauri/tauri.conf.json')).version,
    cargo: lire(racine, 'src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    paquet: JSON.parse(lire(racine, 'package.json')).version,
  };
}

/** Version publiée par cette étiquette ; refuse si l'étiquette et les trois numéros ne concordent pas. */
export function verifierVersion(etiquette, racine = RACINE) {
  const { tauri, cargo, paquet } = versionsDuDepot(racine);
  if (!/^\d+\.\d+\.\d+$/.test(tauri ?? '')) refuser(`Version illisible dans tauri.conf.json : ${tauri}`);
  if (cargo !== tauri || paquet !== tauri) {
    refuser(`Versions différentes : tauri.conf.json ${tauri}, Cargo.toml ${cargo}, package.json ${paquet}.`);
  }
  if (etiquette !== `v${tauri}`) refuser(`L'étiquette « ${etiquette} » ne correspond pas à la version ${tauri} (attendu : v${tauri}).`);
  const productName = JSON.parse(lire(racine, 'src-tauri/tauri.conf.json')).productName;
  if (`${productName}_` !== PREFIXE_INSTALLEUR) {
    refuser(`productName a changé (${productName}) : les apps Windows n'accepteraient plus la mise à jour.`);
  }
  return tauri;
}

/** Texte court de latest.json : le bloc ```text de la section « latest.json » des notes publiques. */
export function texteCourt(version, racine = RACINE) {
  const fichier = path.join(racine, '.github', 'release-notes', `${version}.md`);
  if (!existsSync(fichier)) refuser(`Notes introuvables : .github/release-notes/${version}.md`);
  const bloc = readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n')
    .match(/^## Texte court pour `latest\.json`.*?\n```text\n(.+?)\n```/ms);
  if (!bloc) refuser('Section « Texte court pour `latest.json` » introuvable dans les notes.');
  const texte = bloc[1].trim();
  if (/[\n"]/.test(texte) || texte.length === 0) refuser('Le texte court tient sur une ligne, sans guillemet double.');
  return texte;
}

/**
 * Texte de la page de la release GitHub : les notes publiques jusqu'au texte court, puis comment
 * vérifier les fichiers (empreintes, certificats de fabrication, clés publiques).
 */
export function corpsRelease(version, racine = RACINE) {
  const notes = readFileSync(path.join(racine, '.github', 'release-notes', `${version}.md`), 'utf8').replace(/\r\n/g, '\n');
  const debut = notes.split(/^## Texte court pour `latest\.json`/m)[0]
    .replace(/<!--[\s\S]*?-->\n*/g, '').replace(/\n---\s*$/, '').trim();
  const cle = numeroCle(JSON.parse(lire(racine, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey);
  return `${debut}

## Vérifier les fichiers / Verify the files

Ces fichiers ont été compilés et signés par GitHub Actions à partir du code de cette version, et sont
aussi servis, à l'identique, depuis \`${ADRESSE_FICHIERS}\`. / These files were built and signed by GitHub
Actions from this version's code, and the same files are served from \`${ADRESSE_FICHIERS}\`.

- Empreintes SHA-256 / SHA-256 checksums : \`SHA256SUMS.txt\`.
- Certificat de fabrication / Build provenance : \`gh attestation verify <fichier> --repo kunai974/nyx-player\`
- APK : certificat de signature / signing certificate SHA-256 \`${EMPREINTE_APK}\`
  (\`apksigner verify --print-certs <apk>\`).
- Windows : clé publique des mises à jour / update public key \`${cle}\` (\`src-tauri/tauri.conf.json\`).
- Sources de mpv.exe (GPL) / mpv.exe corresponding source : release \`native-deps-1\` de ce dépôt / of this repository.
`;
}

/** Numéro de la clé minisign (16 caractères hexadécimaux) d'une clé publique ou d'une signature Tauri. */
export function numeroCle(encode) {
  let texte = encode.trim();
  if (!texte.includes('untrusted comment')) texte = Buffer.from(texte, 'base64').toString('utf8');
  const ligne = texte.split('\n').map((l) => l.trim())
    .find((l) => l && !l.startsWith('untrusted comment') && !l.startsWith('trusted comment'));
  const octets = Buffer.from(ligne ?? '', 'base64');
  if (octets.length < 10) refuser('Clé ou signature illisible.');
  return Buffer.from(octets.subarray(2, 10)).reverse().toString('hex').toUpperCase();
}

/** Nom du fichier couvert par une signature Tauri (3e ligne, commentaire signé), comme l'app le lit. */
export function fichierSigne(signature) {
  const lignes = Buffer.from(signature.trim(), 'base64').toString('utf8').split('\n');
  const commentaire = lignes[2]?.replace(/\r$/, '');
  if (!commentaire?.startsWith('trusted comment: ')) return null;
  const champ = commentaire.slice('trusted comment: '.length).split('\t').find((c) => c.startsWith('file:'));
  return champ ? champ.slice('file:'.length) : null;
}

/** Refuse une signature faite avec une autre clé que celle des apps, ou pour un autre fichier. */
export function verifierSignatureWindows(signature, version, racine = RACINE) {
  const attendue = numeroCle(JSON.parse(lire(racine, 'src-tauri/tauri.conf.json')).plugins.updater.pubkey);
  const trouvee = numeroCle(signature);
  if (trouvee !== attendue) refuser(`Installeur signé avec une autre clé (${trouvee}, les apps attendent ${attendue}).`);
  const fichier = fichierSigne(signature);
  if (fichier !== `${PREFIXE_INSTALLEUR}${version}_x64-setup.exe`) {
    refuser(`Signature faite pour « ${fichier} », pas pour la version ${version} : les apps refuseraient la mise à jour.`);
  }
  return trouvee;
}

/** Empreinte du certificat, au format « AC:F3:… », lue dans la sortie de `apksigner verify --print-certs`. */
export function empreinteDepuisApksigner(sortie) {
  const hex = sortie.match(/certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/)?.[1];
  if (!hex) refuser("Empreinte introuvable dans la sortie d'apksigner.");
  return hex.toUpperCase().match(/.{2}/g).join(':');
}

/** Nom interne lu dans la sortie de `aapt2 dump badging`. */
export function paquetDepuisAapt2(sortie) {
  const nom = sortie.match(/package: name='([^']+)'/)?.[1];
  if (!nom) refuser("Nom interne introuvable dans la sortie d'aapt2.");
  return nom;
}

function outilsAndroid() {
  const sdk = process.env.ANDROID_HOME;
  if (!sdk) refuser('ANDROID_HOME non défini.');
  const versions = readdirSync(path.join(sdk, 'build-tools')).filter((v) => /^\d+(\.\d+)+$/.test(v))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (versions.length === 0) refuser('Aucun build-tools Android.');
  return path.join(sdk, 'build-tools', versions.at(-1));
}

/** Bonne app et bonne clé, sinon refus. */
export function verifierApk(apk) {
  const outils = outilsAndroid();
  const certificats = execFileSync(path.join(outils, 'apksigner'), ['verify', '--print-certs', apk], { encoding: 'utf8' });
  const empreinte = empreinteDepuisApksigner(certificats);
  if (empreinte !== EMPREINTE_APK) refuser(`MAUVAISE CLÉ : ${apk} (${empreinte}, attendu ${EMPREINTE_APK}).`);
  const paquet = paquetDepuisAapt2(execFileSync(path.join(outils, 'aapt2'), ['dump', 'badging', apk], { encoding: 'utf8' }));
  if (paquet !== PAQUET_APK) refuser(`MAUVAISE APP : ${apk} (${paquet}, attendu ${PAQUET_APK}).`);
  // Bibliothèques natives alignées sur 16 Ko (comme Gradle) : sinon, échec de chargement sur les
  // appareils à pages de 16 Ko
  try {
    execFileSync(path.join(outils, 'zipalign'), ['-c', '-P', '16', '4', apk], { encoding: 'utf8' });
  } catch {
    refuser(`APK mal aligné (16 Ko attendus) : ${apk}`);
  }
  return { empreinte, paquet };
}

/** Refuse une compilation lancée avec une variable du banc ou d'audit. */
export function verifierVariables(env = process.env) {
  const restees = VARIABLES_INTERDITES.filter((v) => env[v] !== undefined);
  if (restees.length > 0) refuser(`Compilation refusée : ${restees.join(', ')} défini.`);
}

const sha256 = (fichier) => createHash('sha256').update(readFileSync(fichier)).digest('hex');
const date = (maintenant) => maintenant.toISOString().replace(/\.\d{3}Z$/, 'Z');
const json = (objet) => `${JSON.stringify(objet, null, 2)}\n`;

/**
 * À partir du dossier des fichiers publiés (installeur, sa signature .sig, deux APK) : contenu de
 * latest.json (apps Windows), android.json (apps Android) et SHA256SUMS.txt. Mêmes champs que les
 * scripts du PC ; les adresses sont celles de R2, où les mêmes fichiers sont déposés.
 */
export function manifestes(dossier, version, notes, maintenant = new Date(), racine = RACINE) {
  const installeur = path.join(dossier, nomInstalleur(version));
  const sig = `${installeur}.sig`;
  const attendus = [installeur, sig, ...APK.map((a) => path.join(dossier, nomApk(a.nom, version)))];
  for (const f of attendus) {
    if (!existsSync(f)) refuser(`Fichier manquant : ${path.basename(f)}`);
  }
  // Un fichier de plus, déposé par une compilation, partirait dans la release sans contrôle
  const enTrop = readdirSync(dossier).filter((n) => !attendus.map((f) => path.basename(f)).includes(n));
  if (enTrop.length > 0) refuser(`Fichiers inattendus : ${enTrop.join(', ')}`);
  const signature = readFileSync(sig, 'utf8').trim();
  verifierSignatureWindows(signature, version, racine);
  const latest = {
    version,
    notes,
    pub_date: date(maintenant),
    platforms: { 'windows-x86_64': { signature, url: `${ADRESSE_FICHIERS}${nomInstalleur(version)}` } },
  };
  const apks = {};
  for (const { nom } of APK) {
    const f = path.join(dossier, nomApk(nom, version));
    apks[nom] = { url: `${ADRESSE_FICHIERS}${nomApk(nom, version)}`, sha256: sha256(f), size: statSync(f).size };
  }
  const android = { version, pub_date: date(maintenant), apks };
  const publies = [nomInstalleur(version), `${nomInstalleur(version)}.sig`, ...APK.map((a) => nomApk(a.nom, version))];
  const sommes = publies.map((n) => `${sha256(path.join(dossier, n))}  ${n}\n`).join('');
  return { latest: json(latest), android: json(android), sommes };
}

function principal([commande, ...args]) {
  switch (commande) {
    case 'version': return console.log(verifierVersion(args[0]));
    case 'notes': return console.log(texteCourt(args[0]));
    case 'corps': return process.stdout.write(corpsRelease(args[0]));
    case 'signature-windows': return console.log(`Signature vérifiée, clé ${verifierSignatureWindows(readFileSync(args[0], 'utf8'), args[1])}.`);
    case 'apk': { const r = verifierApk(args[0]); return console.log(`BONNE APP, BONNE CLÉ : ${args[0]} (${r.paquet})`); }
    case 'variables': verifierVariables(); return console.log('Aucune variable du banc ou d\'audit.');
    case 'manifestes': {
      const [dossier, version] = args;
      const { latest, android, sommes } = manifestes(dossier, version, texteCourt(version));
      // Sans BOM : les apps n'en veulent pas
      writeFileSync(path.join(dossier, 'latest.json'), latest, 'utf8');
      writeFileSync(path.join(dossier, 'android.json'), android, 'utf8');
      writeFileSync(path.join(dossier, 'SHA256SUMS.txt'), sommes, 'utf8');
      return console.log(`latest.json, android.json et SHA256SUMS.txt écrits dans ${dossier}.`);
    }
    default: refuser(`Commande inconnue : ${commande ?? '(aucune)'}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(erreur instanceof ErreurPublication ? erreur.message : erreur);
    process.exit(1);
  }
}
