/**
 * Android : signature des APK de publication. La clé et son mot de passe
 * restent hors du dépôt ; sans eux, l'APK release reste non signé comme avant (CI du PC, scripts de test).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const gradle = readFileSync(resolve(ROOT, 'src-tauri/gen/android/app/build.gradle.kts'), 'utf8');
const gitignore = readFileSync(resolve(ROOT, 'src-tauri/gen/android/.gitignore'), 'utf8');
const script = readFileSync(resolve(ROOT, 'scripts/android-release-apk.ps1'), 'utf8');
// Guide de publication tenu par le mainteneur : absent d'une copie publique du dépôt
const cheminGuide = resolve(ROOT, 'docs/RELEASE_GUIDE.md');
const guide = existsSync(cheminGuide) ? readFileSync(cheminGuide, 'utf8') : null;

const EMPREINTE = 'AC:F3:08:87:EA:EC:C9:88:BC:9C:F5:92:17:C3:D5:4A:6D:79:E7:8F:0E:09:0A:49:EB:48:1A:7C:50:4A:9D:28';

describe('signature des APK de publication', () => {
  it('la clé, l\'alias et les mots de passe viennent des variables d\'environnement', () => {
    for (const name of ['NYX_ANDROID_KEYSTORE', 'NYX_ANDROID_KEYSTORE_PASSWORD', 'NYX_ANDROID_KEY_ALIAS', 'NYX_ANDROID_KEY_PASSWORD']) {
      expect(gradle).toContain(`System.getenv("${name}")`);
    }
  });

  it('aucun mot de passe ni chemin de clé écrit dans le fichier Gradle', () => {
    expect(gradle).not.toMatch(/(storePassword|keyPassword)\s*=\s*"/);
    expect(gradle).not.toMatch(/storeFile\s*=\s*file\("/);
    expect(gradle).not.toMatch(/\.jks|\.keystore"/);
  });

  it('sans clé fournie, le type release n\'a pas de signature (APK non signé comme avant)', () => {
    expect(gradle).toContain('if (releaseSigning != null) signingConfig = signingConfigs.getByName("release")');
  });

  it('les fichiers de clé sont ignorés par git dans le projet Android', () => {
    for (const pattern of ['*.jks', '*.keystore', '*.p12', 'keystore.properties']) {
      expect(gitignore.split(/\r?\n/)).toContain(pattern);
    }
  });

  it('le script vérifie l\'empreinte publique', () => {
    expect(script).toContain(`$EmpreinteAttendue = '${EMPREINTE}'`);
  });

  it.skipIf(!guide)('le guide donne la même empreinte publique', () => {
    expect(guide).toContain(EMPREINTE);
    // apksigner l'affiche en minuscules sans « : » : le guide donne aussi cette forme
    expect(guide).toContain(EMPREINTE.replace(/:/g, '').toLowerCase());
  });

  it('le script efface le mot de passe de l\'environnement à la fin', () => {
    expect(script).toMatch(/finally \{\s*Remove-Item Env:NYX_ANDROID_KEYSTORE, Env:NYX_ANDROID_KEY_ALIAS, Env:NYX_ANDROID_KEYSTORE_PASSWORD/);
  });
});
