// @vitest-environment node
// Constaté sur le PC : CI du PC (copie nyx-ci) et compilation de « Nyx Banc » (copie nyx-banc) lancées
// en même temps : la CI est restée figée plus de 40 min dans `tauri android android-studio-script
// --release --target armv7`. `tauri android build` sert ses options sur un port local et en écrit
// l'adresse dans %TEMP%\<identifiant>-server-addr ; le script que Gradle lance pour chaque cible Rust
// la relit (tauri-cli 2.10, src/mobile/mod.rs, write_options et read_options). L'identifiant vient de
// tauri.conf.json : com.nyxplayer.app pour toutes les compilations (Nyx Banc ne change que
// l'applicationId de Gradle). Les deux compilations écrasaient donc le même fichier, et la CI a joint
// le serveur de la compilation du banc. scripts/android.ps1 donne maintenant à chaque copie du projet
// son propre dossier temporaire (TMP/TEMP) pendant la compilation, puis remet celui d'avant.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fichier = fileURLToPath(new URL('../android.ps1', import.meta.url));
const dossierScripts = path.dirname(fichier);
// Fins de ligne Windows (core.autocrlf) ramenées à \n, BOM retiré
const lire = (f) => readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const texte = lire(fichier);
const conf = JSON.parse(readFileSync(fileURLToPath(new URL('../../src-tauri/tauri.conf.json', import.meta.url)), 'utf8'));
const gradle = lire(fileURLToPath(new URL('../../src-tauri/gen/android/app/build.gradle.kts', import.meta.url)));

describe('compilations Android de deux copies en parallèle : chacune son dossier temporaire', () => {
  it('cause : même identifiant Tauri pour toutes les compilations, seul l\'applicationId de Gradle change', () => {
    expect(conf.identifier).toBe('com.nyxplayer.app');
    expect(gradle).toMatch(/applicationId = System\.getenv\("NYX_ANDROID_APP_ID"\) \?: "com\.nyxplayer\.app"/);
  });

  it('TMP et TEMP posés juste avant `npx tauri android`, remis comme avant dans le finally', () => {
    const bloc = texte.slice(texte.lastIndexOf('Push-Location $projectRoot'));
    const essai = bloc.slice(0, bloc.indexOf('} finally {'));
    const fin = bloc.slice(bloc.indexOf('} finally {'));
    expect(essai).toMatch(/\$env:TMP = \$tempPrive\n\s+\$env:TEMP = \$tempPrive\n\s+& npx tauri android @TauriArgs/);
    expect(fin).toMatch(/\$env:TMP = \$tmpAvant/);
    expect(fin).toMatch(/\$env:TEMP = \$tempAvant/);
  });

  it('toutes les compilations Android des scripts passent par android.ps1 (CI, banc, mesure, audit, publication)', () => {
    const autres = ['ci-locale.ps1', 'android-banc-apk.ps1', 'android-mesure-apk.ps1', 'android-audit-apk.ps1', 'android-release-apk.ps1'];
    // Outils de travail (CI du PC, mesure, banc, audit) : absents d'une copie publique du dépôt
    const horsCopiePublique = ['ci-locale.ps1', 'android-mesure-apk.ps1', 'android-banc-apk.ps1', 'android-audit-apk.ps1'];
    for (const nom of autres.filter((n) => !horsCopiePublique.includes(n) || existsSync(path.join(dossierScripts, n)))) {
      const t = lire(path.join(dossierScripts, nom));
      expect(t, nom).toMatch(/android\.ps1'\) build /);
      expect(t, nom).not.toMatch(/^[^#\n]*\btauri android\b/m);
    }
  });

  // Vrai lancement avec PowerShell (pwsh hors Windows, ou Windows PowerShell sur le PC de la CI) :
  // android.ps1 copié dans deux fausses copies du projet, `npx` remplacé par une fonction qui note le
  // dossier temporaire reçu par Tauri (et donc par Gradle et android-studio-script).
  const shell = ['pwsh', process.platform === 'win32' ? 'powershell' : null]
    .filter(Boolean)
    .find((s) => spawnSync(s, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' }).status === 0);

  function lancer(racine, copie, codeTauri = 0) {
    const scripts = path.join(racine, copie, 'scripts');
    mkdirSync(scripts, { recursive: true });
    copyFileSync(fichier, path.join(scripts, 'android.ps1'));
    const code = `
      function npx { Write-Output "TAURI=$env:TMP|$env:TEMP|$args"; $global:LASTEXITCODE = ${codeTauri} }
      $env:TMP = '${path.join(racine, 'terminal-tmp').replace(/'/g, "''")}'; $env:TEMP = '${path.join(racine, 'terminal-temp').replace(/'/g, "''")}'
      & '${path.join(scripts, 'android.ps1').replace(/'/g, "''")}' build --apk --target armv7
      Write-Output "CODE=$LASTEXITCODE"
      Write-Output "APRES=$env:TMP|$env:TEMP"`;
    const env = {
      ...process.env,
      ANDROID_HOME: path.join(racine, 'sdk'),
      NDK_HOME: path.join(racine, 'ndk'),
      JAVA_HOME: path.join(racine, 'jbr'),
      GRADLE_USER_HOME: path.join(racine, 'gradle'),
      // Sans lecteur système, le dossier privé va dans le dossier temporaire du terminal : celui du test
      TMPDIR: racine,
      TMP: path.join(racine, 'terminal-tmp'),
      TEMP: path.join(racine, 'terminal-temp'),
    };
    for (const cle of Object.keys(env)) if (cle.toLowerCase() === 'systemdrive') delete env[cle];
    mkdirSync(env.TMP, { recursive: true });
    mkdirSync(env.TEMP, { recursive: true });
    const r = spawnSync(shell, ['-NoProfile', '-Command', code], { encoding: 'utf8', timeout: 60_000, env });
    const sortie = `${r.stdout}${r.stderr}`;
    const valeur = (cle) => sortie.match(new RegExp(`^${cle}=(.*)$`, 'm'))?.[1];
    const [tmp, temp, args] = (valeur('TAURI') ?? '||').split('|');
    return { sortie, tmp, temp, args, code: valeur('CODE'), apres: valeur('APRES') };
  }

  it.skipIf(!shell)('deux copies : deux dossiers temporaires distincts, stables, créés, sans espace ; terminal remis comme avant', () => {
    const racine = mkdtempSync(path.join(tmpdir(), 'nyx-l154-'));
    try {
      const ci = lancer(racine, 'nyx-ci');
      const banc = lancer(racine, 'nyx-banc');
      const ciBis = lancer(racine, 'nyx-ci', 7);
      expect(ci.tmp, ci.sortie).toBeTruthy();
      // Le point du correctif : plus de fichier d'adresse commun aux deux compilations
      expect(banc.tmp).not.toBe(ci.tmp);
      // Tauri reçoit le même dossier dans TMP et TEMP (Rust lit TMP, Node lit TEMP)
      expect(ci.temp).toBe(ci.tmp);
      expect(banc.temp).toBe(banc.tmp);
      expect(ci.tmp).not.toMatch(/terminal-te?mp$/);
      expect(path.basename(ci.tmp)).toMatch(/^nyx-ci-[0-9a-f]{8}$/);
      expect(path.basename(banc.tmp)).toMatch(/^nyx-banc-[0-9a-f]{8}$/);
      expect(existsSync(ci.tmp) && existsSync(banc.tmp)).toBe(true);
      expect(`${path.basename(ci.tmp)}${path.basename(banc.tmp)}`).not.toMatch(/\s/);
      // Même copie : même dossier d'une fois sur l'autre (démons Gradle réutilisables)
      expect(ciBis.tmp).toBe(ci.tmp);
      // Arguments transmis tels quels, code de sortie de Tauri rendu
      expect(ci.args).toBe('tauri android build --apk --target armv7');
      expect(ci.code).toBe('0');
      expect(ciBis.code).toBe('7');
      // Le terminal retrouve ses TMP et TEMP, même après un échec de Tauri
      const terminal = `${path.join(racine, 'terminal-tmp')}|${path.join(racine, 'terminal-temp')}`;
      expect(ci.apres).toBe(terminal);
      expect(ciBis.apres).toBe(terminal);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  }, 120_000);
});
