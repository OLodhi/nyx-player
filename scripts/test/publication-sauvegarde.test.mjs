// @vitest-environment node
// Publication Windows et sauvegarde Supabase.
// Clé de mise à jour : le guide de publication Windows faisait coller la clé privée de mise à jour et son mot de
// passe dans une commande PowerShell ($env:TAURI_SIGNING_PRIVATE_KEY = '…'), donc dans l'historique
// de PowerShell, sur le disque. Ils passent désormais par scripts/windows-release.ps1, saisis masqués.
// Sauvegarde : la sauvegarde et la restauration Supabase chiffraient sans vérifier le serveur
// (PGSSLMODE=require) et acceptaient des outils PostgreSQL < 16, avec lesquels PGREQUIREAUTH est
// ignoré (mot de passe livré à un faux serveur).
// Pas de PowerShell dans le cloud ni dans `pnpm verify` : vérifications sur le texte des scripts.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = fileURLToPath(new URL('../../', import.meta.url));
// Fins de ligne Windows (core.autocrlf) ramenées à \n, BOM retiré
const lire = (relatif) => readFileSync(path.join(racine, relatif), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
// Guide de publication, notes de version et scripts de sauvegarde de la base : tenus par le
// mainteneur, absents d'une copie publique du dépôt (leurs vérifications y sont sautées)
const existe = (relatif) => existsSync(path.join(racine, relatif));

// Lignes de code (hors commentaires) d'un script PowerShell
const code = (texte) => texte.replace(/<#[\s\S]*?#>/g, '').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// Blocs de code d'un fichier Markdown
const blocs = (texte) => [...texte.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);

function fichiersMd(dossier) {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === 'archive' ? [] : fichiersMd(chemin);
    return nom.endsWith('.md') ? [chemin] : [];
  });
}

describe('La clé de mise à jour Windows ne se tape jamais dans une commande', () => {
  const guide = existe('docs/RELEASE_GUIDE.md') ? lire('docs/RELEASE_GUIDE.md') : null;
  const script = lire('scripts/windows-release.ps1');
  const codeScript = code(script);

  it('aucun bloc de commandes de la documentation ne pose la clé ou son mot de passe', () => {
    const fautifs = [];
    for (const fichier of fichiersMd(path.join(racine, 'docs'))) {
      const texte = readFileSync(fichier, 'utf8');
      for (const bloc of blocs(texte)) {
        for (const ligne of bloc.split('\n')) {
          if (/TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)?\s*=/.test(ligne)) fautifs.push(`${path.relative(racine, fichier)} : ${ligne.trim()}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it.skipIf(!guide)('le guide envoie vers le script pour compiler et signer', () => {
    const etapes = guide.slice(guide.indexOf('### 2. '), guide.indexOf('### 4. '));
    expect(etapes).toContain('./scripts/windows-release.ps1');
    // Plus de compilation signée lancée à la main dans les étapes
    expect(blocs(etapes).join('\n')).not.toMatch(/^\s*pnpm tauri build/m);
    // Avertissement sur l'historique du presse-papiers
    expect(etapes).toMatch(/Win\+V/);
  });

  it('clé et mot de passe : saisis masqués, jamais vus par la compilation, effacés dans un finally', () => {
    // Deux saisies, toutes deux masquées ; aucune autre façon de lire la clé (presse-papiers, paramètre)
    const saisies = [...codeScript.matchAll(/Read-Host[^\n]*/g)].map((m) => m[0]);
    expect(saisies).toHaveLength(2);
    for (const s of saisies) expect(s).toContain('-AsSecureString');
    expect(codeScript).not.toMatch(/Get-Clipboard/);
    expect(script.match(/^param\(([\s\S]*?)^\)/m)?.[1] ?? '').not.toMatch(/cl[eé]|key|password|mot/i);
    expect(codeScript).toContain("if ($motDePasseSecure.Length -eq 0) { throw");
    // La clé n'est posée dans l'environnement QUE dans Invoke-Signature, qui l'efface dans son finally
    const fonction = codeScript.match(/function Invoke-Signature\([^)]*\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
    const poses = [...codeScript.matchAll(/\$env:TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)? =/g)];
    expect(poses).toHaveLength(2);
    for (const pose of poses) expect(fonction).toContain(codeScript.slice(pose.index, pose.index + 50));
    expect(fonction).toMatch(/\} finally \{[\s\S]*Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
    // Outil verrouillé du dépôt, jamais npx (qui peut télécharger un autre paquet)
    expect(fonction).toContain('& pnpm tauri signer sign $fichier');
    expect(codeScript).not.toMatch(/\bnpx\b/);
    // La compilation se fait sans fichiers de mise à jour (donc sans la clé), puis l'installeur est signé
    const compilation = codeScript.indexOf('& pnpm tauri build --config $sansSignature');
    expect(compilation).toBeGreaterThan(-1);
    expect(codeScript).toContain(`'{"bundle":{"createUpdaterArtifacts":false}}'`);
    expect(codeScript.indexOf('Invoke-Signature $installeur')).toBeGreaterThan(compilation);
    expect(codeScript.match(/& pnpm tauri build/g)).toHaveLength(1);
    // Effacement final, même en échec
    expect(codeScript).toMatch(/\} finally \{\n\s+Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD[^\n]*\n\s+if \(\$cleSecure\) \{ \$cleSecure\.Dispose\(\) \}/);
    // Rien n'affiche la clé ni le mot de passe, rien ne les écrit sur le disque
    for (const ligne of codeScript.split('\n')) {
      if (/Write-Host|Write-Output|Set-Content|Out-File|Add-Content|WriteAllText|Set-Clipboard/.test(ligne)) {
        expect(ligne, ligne).not.toMatch(/\$cleSecure|\$debutCle|\$motDePasseSecure|TAURI_SIGNING_PRIVATE_KEY|\$sortie/i);
      }
    }
  });

  it('une relance après une compilation n\'est pas refusée pour des fins de ligne régénérées', () => {
    expect(codeScript).toContain("$_.Etat -eq '??' -or $(& git diff --quiet --ignore-cr-at-eol HEAD -- $_.Chemin");
  });

  it('fichiers modifiés lus en noms bruts : nom accentué, renommage indexé', () => {
    // Sans -z, git met un nom accentué entre guillemets et échappé, et un renommage en « ancien -> nouveau »
    expect(codeScript).toContain('git status --porcelain=v1 -z --untracked-files=all');
    expect(codeScript).not.toMatch(/git status --porcelain(?!=v1 -z)/);
    expect(codeScript).toMatch(/if \(\$jeton\[0\] -eq 'R' -or \$jeton\[0\] -eq 'C'\) \{ \$i\+\+ \}/);
  });

  it('signature refusée : la ligne d\'erreur de l\'outil est montrée, sans les lignes de pnpm ni de PowerShell', () => {
    const fonction = codeScript.match(/function Invoke-Signature\([^)]*\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(fonction).toContain("ELIFECYCLE|NativeCommandError");
    // Position de l'erreur ajoutée par Windows PowerShell : « At C:\…\windows-release.ps1:170 char:5 » ou « Au caractère … »
    expect(fonction).toContain("^At .*char:\\d|^Au caractère");
    expect(fonction).toMatch(/throw "Signature refusée par tauri signer : \$\(\$erreur\.Trim\(\)\)/);
  });

  it('les contrôles sans la clé passent avant toute saisie', () => {
    const premiereSaisie = codeScript.indexOf('Read-Host');
    for (const refus of ['Compilation refusée : $($restees', 'Une clé de signature est déjà posée', 'fichiers modifiés hors version', 'Versions différentes']) {
      const i = codeScript.indexOf(refus);
      expect(i, refus).toBeGreaterThan(-1);
      expect(i, refus).toBeLessThan(premiereSaisie);
    }
    // Même liste de variables interdites que la publication Android
    const liste = (t) => t.match(/^\$VariablesInterdites = (.+\n.+)$/m)?.[1].replace(/\s+/g, ' ');
    expect(liste(script)).toBe(liste(lire('scripts/android-release-apk.ps1')));
  });

  it('la signature produite est vérifiée (clé et version) avant d\'écrire latest.json, avec le préfixe de l\'app', () => {
    const appUpdate = lire('src-tauri/src/app_update.rs');
    const prefixeApp = appUpdate.match(/const INSTALLER_PREFIX: &str = "([^"]+)";/)?.[1];
    expect(prefixeApp).toBe('Nyx Player_');
    expect(script).toContain(`$PrefixeInstalleur = '${prefixeApp}'`);
    expect(JSON.parse(lire('src-tauri/tauri.conf.json')).productName + '_').toBe(prefixeApp);
    const ecriture = codeScript.indexOf('WriteAllText($cheminManifeste');
    for (const controle of ['if ($cleSignature -ne $cleAttendue)', 'if ($signePour -ne "$PrefixeInstalleur${version}_x64-setup.exe")']) {
      const i = codeScript.indexOf(controle);
      expect(i, controle).toBeGreaterThan(-1);
      expect(i, controle).toBeLessThan(ecriture);
    }
    // Comme l'app : seule la 3e ligne (commentaire signé) est lue
    expect(codeScript).toMatch(/\$lignes\[2\]\.StartsWith\('trusted comment: '\)/);
    // Sans BOM
    expect(codeScript).toMatch(/WriteAllText\(\$cheminManifeste, .+\[Text\.UTF8Encoding\]::new\(\$false\)\)/);
  });

  it.skipIf(!guide)('les notes de la version existent là où le script les cherche', () => {
    const version = JSON.parse(lire('src-tauri/tauri.conf.json')).version;
    const prochaine = readdirSync(path.join(racine, 'docs')).filter((n) => /^NOTES_DE_VERSION_\d+\.\d+\.\d+\.md$/.test(n));
    expect(prochaine.length).toBeGreaterThan(0);
    for (const nom of prochaine) {
      const texte = lire(`docs/${nom}`);
      const notes = texte.match(/## Texte court pour `latest\.json`[\s\S]*?```text\n(.+?)\n```/)?.[1];
      expect(notes, nom).toBeTruthy();
      expect(notes, nom).not.toContain('"');
    }
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('Sauvegarde et restauration Supabase, serveur vérifié et outils récents', () => {
  for (const nom of ['scripts/supabase-sauvegarde.ps1', 'scripts/supabase-restauration.ps1'].filter(existe)) {
    const texte = code(lire(nom));

    it(`${nom} : verify-full avec le certificat de Supabase, effacés à la fin`, () => {
      const modes = [...texte.matchAll(/\$env:PGSSLMODE = '([^']+)'/g)].map((m) => m[1]);
      expect(modes).toEqual(['verify-full']);
      expect(texte).toMatch(/\$env:PGSSLROOTCERT = \$[Cc]ertificat\n/);
      expect(texte).toMatch(/'supabase-ca\.crt'/);
      expect(texte).toContain('Remove-Item Env:PGSSLROOTCERT -ErrorAction SilentlyContinue');
      expect(texte).toContain("$env:PGREQUIREAUTH = 'scram-sha-256'");
      // Aucun réglage PostgreSQL venu d'ailleurs (PGSERVICE…) ne passe avant les nôtres
      const purge = texte.indexOf("Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' -and $_.Name -ne 'PGPASSWORD' }");
      expect(purge).toBeGreaterThan(-1);
      expect(purge).toBeLessThan(texte.indexOf("$env:PGSSLMODE = 'verify-full'"));
      // Une seule adresse : pas de liste d'hôtes
      expect(texte).toContain('(?<host>[^:/,]+)');
      // Certificat absent : refus avant toute demande de mot de passe
      const refus = texte.indexOf('Certificat de Supabase introuvable');
      expect(refus).toBeGreaterThan(-1);
      expect(refus).toBeLessThan(texte.indexOf('Read-Host'));
    });

    it(`${nom} : outils PostgreSQL de version 16 ou plus seulement`, () => {
      expect(texte).toMatch(/^\$versionPgMinimale = 16$/m);
      // Chaque candidat passe par le contrôle de version : plus de « premier trouvé » sans contrôle
      const fonction = texte.match(/function Find-PgTool\([^)]*\) \{\n([\s\S]*?)\n\}/)?.[1] ?? '';
      expect(fonction).toMatch(/if \(\(Get-PgMajeure \$chemin\) -ge \$versionPgMinimale\) \{ return \$chemin \}/);
      expect(fonction.match(/return \$\w+/g)).toEqual(['return $chemin', 'return $null']);
      expect(fonction).not.toMatch(/return \$cmd/);
      expect(texte).toMatch(/\\\(PostgreSQL\\\)\\s\+\(\\d\+\)/);
    });
  }

  it.skipIf(!existe('scripts/supabase-sauvegarde.ps1'))('le mot de passe enregistré se relit toujours (correctif .Trim() gardé)', () => {
    expect(lire('scripts/supabase-sauvegarde.ps1')).toContain('(Get-Content $fichierMotDePasse -Raw).Trim() | ConvertTo-SecureString');
  });
});

describe('latest.json vérifié à chaque changement', () => {
  it('la vérification Rust de la PR se lance aussi quand seul latest.json change', () => {
    const rust = lire('.github/workflows/rust.yml');
    const chemins = rust.match(/pull_request:\n[\s\S]*?paths:\n((?:\s+- .+\n)+)/)?.[1] ?? '';
    expect(chemins).toContain("- 'web/updates/latest.json'");
    expect(chemins).toContain("- 'src-tauri/**'");
  });
});
