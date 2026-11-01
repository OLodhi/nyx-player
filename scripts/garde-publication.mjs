// Garde-fou de publication : une version publiée ne doit
// jamais être compilée en mode audit (VITE_AUDIT=1) ou banc (VITE_BANC=1). Une telle version n'aurait
// pas Sentry, porterait le pont d'audit et, pour le banc, refuserait toute lecture.
//
// Appelé par vite.config.ts à chaque `vite build` (donc aussi `pnpm tauri build`, l'APK Android et la
// CI). Le mode audit n'est admis que si :
// - la compilation vient d'un script d'audit (compilations d'audit Windows et Android,
//   vérification du bundle), qui pose NYX_VERSION_AUDIT=1 dans le processus : une variable
//   VITE_AUDIT oubliée (dans .env.local, dans le terminal) ne suffit donc jamais ;
// - et aucune clé de signature des mises à jour n'est présente (TAURI_SIGNING_PRIVATE_KEY : seule une
//   publication Windows en a besoin, scripts/windows-release.ps1).
// Le serveur de développement (vite, Vitest, mode aperçu) n'est pas concerné : rien n'y est publié.

import { problemesBinaires } from './binaires-natifs.mjs';

/**
 * Rend null si la compilation peut continuer, sinon la raison du refus (jamais une valeur secrète).
 * `vite` : variables VITE_* vues par Vite (fichiers .env compris) ; `processus` : process.env.
 */
export function refusPublication({ commande, vite = {}, processus = {} }) {
  if (commande !== 'build') return null;
  const audit = vite.VITE_AUDIT === '1';
  const banc = vite.VITE_BANC === '1';
  // Variante « vrai lecteur » du banc (zone 6 bis) : seulement avec VITE_BANC=1, et seulement « reel »
  const lecteur = vite.VITE_BANC_LECTEUR;
  if (lecteur !== undefined && lecteur !== '') {
    if (!banc) return 'Compilation refusée : VITE_BANC_LECTEUR sans VITE_BANC=1. Cette variante ne se compile que pour le banc (scripts d\'audit, option -LecteurReel).';
    if (lecteur !== 'reel') return 'Compilation refusée : VITE_BANC_LECTEUR ne vaut que « reel ».';
  }
  // Empreinte embarquée et variante compilée d'accord : une VITE_BANC_LECTEUR restée dans un .env ne fait
  // jamais passer une version au vrai lecteur pour la version au lecteur simulé (ni l'inverse)
  const empreinte = vite.VITE_AUDIT_BUILD;
  if (banc && empreinte && String(empreinte).endsWith('+lecteur+banc') !== (lecteur === 'reel')) {
    return 'Compilation refusée : l\'empreinte de la version et la variante du lecteur ne vont pas ensemble. Une variable VITE_BANC_LECTEUR traîne sans doute (.env, .env.local) : la retirer, ou compiler avec -LecteurReel.';
  }
  // Adresse de test du manifeste des mises à jour Android : versions d'audit seulement. Une version
  // publiée l'ignorerait (src/services/androidUpdate.ts) et sa clé n'admet que les adresses de Nyx
  // (AppUpdatePolicy.kt) ; refusée quand même, pour qu'une variable oubliée dans un .env se voie.
  const manifeste = vite.VITE_ANDROID_UPDATE_MANIFEST;
  if (manifeste !== undefined && manifeste !== '' && !audit) {
    return 'Compilation refusée : VITE_ANDROID_UPDATE_MANIFEST hors d\'une version d\'audit. Elle ne se pose que par scripts/android-audit-apk.ps1 -ManifesteMaj ; la retirer (terminal, .env, .env.local).';
  }
  if (!audit && !banc) return null;
  const mode = banc ? 'banc (VITE_BANC=1)' : 'audit (VITE_AUDIT=1)';
  if (banc && !audit) return `Compilation refusée : VITE_BANC=1 sans VITE_AUDIT=1. Le banc se compile toujours avec VITE_AUDIT=1 et VITE_BANC=1.`;
  if (processus.TAURI_SIGNING_PRIVATE_KEY) {
    return `Compilation refusée : mode ${mode} avec la clé de signature des mises à jour présente. Une version publiée ne se compile jamais en mode audit : ouvrir un nouveau terminal pour l'audit, ou retirer VITE_AUDIT / VITE_BANC (terminal, .env.local) pour la publication.`;
  }
  if (processus.NYX_VERSION_AUDIT !== '1') {
    return `Compilation refusée : mode ${mode} hors des scripts d'audit. Une variable VITE_AUDIT ou VITE_BANC traîne sans doute (terminal, .env, .env.local) : la retirer. Les versions d'audit se compilent par scripts/windows-audit-build.ps1 ou scripts/android-audit-apk.ps1.`;
  }
  return null;
}

/**
 * Refuse une compilation Windows (`pnpm tauri build`, qui lance `vite build` avec
 * TAURI_ENV_PLATFORM=windows) quand le lecteur mpv.exe embarqué n'est pas le vrai programme (pointeur
 * Git LFS d'une copie du dépôt sans son contenu LFS, fichier tronqué) : l'app installée afficherait
 * « Application 16 bits non prise en charge » à la première lecture. Rend null si la compilation peut
 * continuer. Les versions d'audit (NYX_VERSION_AUDIT=1) ne sont pas concernées : jamais publiées, et le
 * banc au lecteur simulé n'a pas besoin de mpv.
 */
export function refusBinairesWindows({ commande, processus = {}, racine }) {
  if (commande !== 'build' || processus.TAURI_ENV_PLATFORM !== 'windows' || processus.NYX_VERSION_AUDIT === '1') return null;
  const problemes = racine ? problemesBinaires('windows', racine) : problemesBinaires('windows');
  if (problemes.length === 0) return null;
  return `Compilation refusée : le lecteur vidéo de l'app Windows n'est pas le bon fichier.\n${problemes.join('\n')}`;
}
