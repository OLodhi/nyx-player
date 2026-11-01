// @vitest-environment node
// Contrôles de la publication fabriquée sur GitHub (scripts/publication-ci.mjs, appelé par
// .github/workflows/release.yml). Une erreur ici : une version signée avec une autre clé, pour une
// autre version, ou un fichier de mise à jour que les apps refuseraient, partirait sans alerte.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APK, EMPREINTE_APK, VARIABLES_INTERDITES, corpsRelease, empreinteDepuisApksigner, fichierSigne,
  manifestes, nomApk, nomInstalleur, numeroCle, paquetDepuisAapt2, texteCourt, verifierSignatureWindows,
  verifierVariables, verifierVersion, versionsDuDepot,
} from '../publication-ci.mjs';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const lire = (relatif) => readFileSync(path.join(racine, relatif), 'utf8');
const conf = JSON.parse(lire('src-tauri/tauri.conf.json'));

// Signature publiée de l'installeur 0.7.6 (faite avec la vraie clé, publique) : src-tauri/src/app_update.rs
const SIGNATURE_0_7_6 = lire('src-tauri/src/app_update.rs').match(/const SIGNATURE_0_7_6: &str = "([^"]+)"/)[1];

describe('version et étiquette', () => {
  it('les trois numéros du dépôt concordent, et seule l\'étiquette v<version> passe', () => {
    const { tauri, cargo, paquet } = versionsDuDepot();
    expect(cargo).toBe(tauri);
    expect(paquet).toBe(tauri);
    expect(verifierVersion(`v${tauri}`)).toBe(tauri);
    expect(() => verifierVersion(tauri)).toThrow(/ne correspond pas/);
    expect(() => verifierVersion(`v${tauri}.1`)).toThrow(/ne correspond pas/);
    expect(() => verifierVersion('v9.9.9')).toThrow(/ne correspond pas/);
  });

  it('refuse des numéros différents dans le dépôt', () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'nyx-pub-'));
    try {
      mkdirSync(path.join(dossier, 'src-tauri'));
      writeFileSync(path.join(dossier, 'src-tauri/tauri.conf.json'), JSON.stringify({ ...conf, version: '0.8.0' }));
      writeFileSync(path.join(dossier, 'src-tauri/Cargo.toml'), '[package]\nname = "nyxplayer"\nversion = "0.7.6"\n');
      writeFileSync(path.join(dossier, 'package.json'), JSON.stringify({ version: '0.8.0' }));
      expect(() => verifierVersion('v0.8.0', dossier)).toThrow(/Versions différentes/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});

describe('notes', () => {
  it('le texte court tient sur une ligne et reprend celui des notes de travail quand elles existent', () => {
    const { tauri } = versionsDuDepot();
    const texte = texteCourt(tauri);
    expect(texte).not.toMatch(/[\n"]/);
    expect(texte.length).toBeGreaterThan(20);
    const travail = path.join(racine, 'docs', `NOTES_DE_VERSION_${tauri}.md`);
    if (existsSync(travail)) expect(readFileSync(travail, 'utf8')).toContain(texte);
  });

  it('la page de la release dit comment vérifier, sans brouillon ni commentaire interne', () => {
    const corps = corpsRelease(versionsDuDepot().tauri);
    expect(corps).toContain('gh attestation verify');
    expect(corps).toContain(EMPREINTE_APK);
    expect(corps).toContain(numeroCle(conf.plugins.updater.pubkey));
    expect(corps).not.toMatch(/<!--|À COMPLÉTER|Texte court/);
  });
});

describe('signature Windows', () => {
  it('lit le numéro de la clé publique des apps et celui de la signature 0.7.6 (la même clé)', () => {
    expect(numeroCle(conf.plugins.updater.pubkey)).toMatch(/^[0-9A-F]{16}$/);
    expect(numeroCle(SIGNATURE_0_7_6)).toBe(numeroCle(conf.plugins.updater.pubkey));
    expect(fichierSigne(SIGNATURE_0_7_6)).toBe('Nyx Player_0.7.6_x64-setup.exe');
  });

  it('accepte la bonne clé pour la bonne version, refuse une autre version', () => {
    expect(verifierSignatureWindows(SIGNATURE_0_7_6, '0.7.6')).toBe(numeroCle(conf.plugins.updater.pubkey));
    expect(() => verifierSignatureWindows(SIGNATURE_0_7_6, '0.8.0')).toThrow(/pas pour la version 0\.8\.0/);
    expect(() => verifierSignatureWindows(SIGNATURE_0_7_6, '0.7')).toThrow(/pas pour la version/);
  });

  it('refuse une signature faite avec une autre clé', () => {
    const texte = Buffer.from(SIGNATURE_0_7_6, 'base64').toString('utf8').split('\n');
    const octets = Buffer.from(texte[1], 'base64');
    octets[2] ^= 0xff; // autre numéro de clé
    texte[1] = octets.toString('base64');
    const autre = Buffer.from(texte.join('\n')).toString('base64');
    expect(() => verifierSignatureWindows(autre, '0.7.6')).toThrow(/autre clé/);
  });
});

describe('APK', () => {
  it('même empreinte et mêmes variables refusées que le script du PC', () => {
    const ps1 = lire('scripts/android-release-apk.ps1');
    expect(ps1).toContain(`$EmpreinteAttendue = '${EMPREINTE_APK}'`);
    const liste = ps1.match(/\$VariablesInterdites = ([^\n]+\n[^\n]+)/)[1];
    expect([...liste.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])).toEqual(VARIABLES_INTERDITES);
  });

  it('lit l\'empreinte d\'apksigner et le nom interne d\'aapt2', () => {
    const hex = EMPREINTE_APK.replaceAll(':', '').toLowerCase();
    expect(empreinteDepuisApksigner(`Signer #1 certificate DN: CN=Nyx\nSigner #1 certificate SHA-256 digest: ${hex}\n`)).toBe(EMPREINTE_APK);
    expect(() => empreinteDepuisApksigner('DOES NOT VERIFY')).toThrow(/Empreinte introuvable/);
    expect(paquetDepuisAapt2("package: name='com.nyxplayer.app.banc' versionCode='1'")).toBe('com.nyxplayer.app.banc');
  });

  it('refuse une compilation lancée avec une variable du banc', () => {
    expect(() => verifierVariables({})).not.toThrow();
    expect(() => verifierVariables({ VITE_BANC: '1' })).toThrow(/VITE_BANC/);
  });
});

describe('fichiers de mise à jour', () => {
  const version = '0.7.6';
  const preparer = () => {
    const dossier = mkdtempSync(path.join(tmpdir(), 'nyx-pub-'));
    writeFileSync(path.join(dossier, nomInstalleur(version)), 'installeur');
    writeFileSync(path.join(dossier, `${nomInstalleur(version)}.sig`), `${SIGNATURE_0_7_6}\n`);
    for (const { nom } of APK) writeFileSync(path.join(dossier, nomApk(nom, version)), `apk ${nom}`);
    return dossier;
  };

  it('latest.json et android.json ont les champs que lisent les apps, avec les adresses de R2', () => {
    const dossier = preparer();
    try {
      const maintenant = new Date('2026-11-01T12:00:00.000Z');
      const { latest, android, sommes } = manifestes(dossier, version, 'Notes', maintenant);
      expect(latest.charCodeAt(0)).not.toBe(0xfeff);
      expect(JSON.parse(latest)).toEqual({
        version, notes: 'Notes', pub_date: '2026-11-01T12:00:00Z',
        platforms: { 'windows-x86_64': { signature: SIGNATURE_0_7_6, url: 'https://releases.nyxplayer.app/Nyx-Player_0.7.6_x64-setup.exe' } },
      });
      const a = JSON.parse(android);
      expect(Object.keys(a.apks)).toEqual(['arm64', 'armv7']);
      expect(a.apks.arm64).toEqual({
        url: 'https://releases.nyxplayer.app/nyx-player-arm64-v0.7.6.apk',
        sha256: createHash('sha256').update('apk arm64').digest('hex'),
        size: 'apk arm64'.length,
      });
      expect(sommes.trim().split('\n')).toHaveLength(4);
      expect(sommes).toContain('  Nyx-Player_0.7.6_x64-setup.exe\n');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it('refuse un fichier manquant, en trop, ou une signature pour une autre version', () => {
    const dossier = preparer();
    try {
      writeFileSync(path.join(dossier, 'en-trop.exe'), 'x');
      expect(() => manifestes(dossier, version, 'Notes')).toThrow(/Fichiers inattendus : en-trop\.exe/);
      rmSync(path.join(dossier, 'en-trop.exe'));
      expect(() => manifestes(dossier, '0.8.0', 'Notes')).toThrow(/Fichier manquant/);
      rmSync(path.join(dossier, nomApk('armv7', version)));
      expect(() => manifestes(dossier, version, 'Notes')).toThrow(/Fichier manquant : nyx-player-armv7-v0\.7\.6\.apk/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });
});
