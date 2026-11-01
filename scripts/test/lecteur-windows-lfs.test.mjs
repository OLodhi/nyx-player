// @vitest-environment node
// Une version Windows compilée dans une copie du dépôt sans le contenu Git LFS
// embarquait resources/mpv/mpv.exe sous forme de pointeur texte de 134 octets (« version
// https://git-lfs.github.com/spec/v1 … »). À la première lecture, Windows affichait « Application
// 16 bits non prise en charge ». Ni `pnpm tauri build` ni scripts/windows-release.ps1 ne le voyaient.
// Désormais : le script de publication refuse dès l'étape 1, et toute compilation Windows hors audit
// (`pnpm tauri build`) aussi.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BINAIRES, empreinte, problemesBinaires } from '../binaires-natifs.mjs';
import { refusBinairesWindows } from '../garde-publication.mjs';

const racine = fileURLToPath(new URL('../../', import.meta.url));
const lire = (relatif) => readFileSync(path.join(racine, relatif), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

const POINTEUR = 'version https://git-lfs.github.com/spec/v1\noid sha256:b8e6ce5ec94f2ab3b7e3ec851d6ffe6f5761962dcb7282bf985b9ffe6a0dccba\nsize 115844096\n';

const dossiers = [];
afterEach(() => { for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Copie de dépôt jetable où resources/mpv/mpv.exe a le contenu donné (absent si null). */
function copie(contenu) {
  const d = mkdtempSync(path.join(tmpdir(), 'nyx-lfs-'));
  dossiers.push(d);
  if (contenu !== null) {
    mkdirSync(path.join(d, 'resources/mpv'), { recursive: true });
    writeFileSync(path.join(d, 'resources/mpv/mpv.exe'), contenu);
  }
  return d;
}

/** `node scripts/binaires-natifs.mjs windows --verifier --racine <d>` */
const verifier = (d) => spawnSync(process.execPath, [path.join(racine, 'scripts/binaires-natifs.mjs'), 'windows', '--verifier', '--racine', d], { encoding: 'utf8' });

/** Faux binaire de plus de 1 Mo, et la liste BINAIRES qui l'attend avec son empreinte. */
function fauxBinaire() {
  const contenu = Buffer.alloc(2 * 1024 * 1024, 7);
  const binaires = [{ cible: 'windows', nom: 'mpv.exe', destination: 'resources/mpv/mpv.exe', sha256: empreinte(contenu) }];
  return { contenu, binaires };
}

describe('lecteur Windows : jamais un pointeur Git LFS dans une version compilée', () => {
  it('pointeur Git LFS : refusé, avec « git lfs pull »', () => {
    const p = problemesBinaires('windows', copie(POINTEUR));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/pointeur Git LFS/);
    expect(p[0]).toContain('git lfs pull');
  });

  it('fichier absent, ou de moins de 1 Mo : refusé, avec « git lfs pull »', () => {
    expect(problemesBinaires('windows', copie(null))[0]).toMatch(/introuvable.*binaires-natifs\.mjs windows.*git lfs pull/);
    const p = problemesBinaires('windows', copie(Buffer.alloc(500 * 1024, 1)));
    expect(p[0]).toMatch(/trop petit.*git lfs pull/);
  });

  it('empreinte différente de celle attendue : refusé', () => {
    const { binaires } = fauxBinaire();
    const p = problemesBinaires('windows', copie(Buffer.alloc(2 * 1024 * 1024, 9)), binaires);
    expect(p[0]).toMatch(/empreinte inattendue.*git lfs pull/);
  });

  it('vrai binaire, bonne empreinte : admis ; les binaires Android ne sont pas regardés', () => {
    const { contenu, binaires } = fauxBinaire();
    expect(problemesBinaires('windows', copie(contenu), binaires)).toEqual([]);
    expect(problemesBinaires('windows', copie(contenu), [...binaires, { ...BINAIRES[1] }])).toEqual([]);
  });

  it('commande `node scripts/binaires-natifs.mjs windows --verifier` : code 1 et message en français sur un pointeur', () => {
    const d = copie(POINTEUR);
    const r = verifier(d);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pointeur Git LFS');
    expect(r.stderr).toContain('git lfs pull');
    // Rien n'est téléchargé ni remplacé
    expect(readFileSync(path.join(d, 'resources/mpv/mpv.exe'), 'utf8')).toBe(POINTEUR);
  });

  // Le vrai mpv.exe n'est là que dans une copie du dépôt avec son contenu Git LFS (ou téléchargé)
  const vraiMpv = path.join(racine, 'resources/mpv/mpv.exe');
  const vraiPresent = existsSync(vraiMpv) && statSync(vraiMpv).size > 1024 * 1024;
  it.skipIf(!vraiPresent)('commande `--verifier` sur le vrai mpv.exe : code 0', () => {
    const r = verifier(racine);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('empreintes vérifiées');
  });

  it('`--racine` sans `--verifier` : refusé (jamais de téléchargement ailleurs)', () => {
    const r = spawnSync(process.execPath, [path.join(racine, 'scripts/binaires-natifs.mjs'), 'windows', '--racine', copie(null)], { encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('chaque binaire suivi par Git LFS et embarqué dans l\'app Windows est vérifié', () => {
    // Motifs LFS de .gitattributes (ici `*.exe`), appliqués au nom du fichier comme le fait git
    const motifs = lire('.gitattributes').split('\n').filter((l) => /\bfilter=lfs\b/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
    expect(motifs.length).toBeGreaterThan(0);
    const versRegex = (m) => new RegExp(`^${m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
    const suit = (fichier) => motifs.some((m) => versRegex(m).test(m.includes('/') ? fichier : path.posix.basename(fichier)));
    const ressources = Object.keys(JSON.parse(lire('src-tauri/tauri.conf.json')).bundle.resources)
      .map((r) => path.posix.normalize(`src-tauri/${r}`));
    const lfs = ressources.filter(suit);
    expect(lfs).toContain('resources/mpv/mpv.exe');
    const verifies = BINAIRES.filter((b) => b.cible === 'windows').map((b) => b.destination);
    for (const f of lfs) expect(verifies, f).toContain(f);
  });
});

describe('compilation Windows (`pnpm tauri build`) : refusée sans le vrai lecteur', () => {
  const windows = { TAURI_ENV_PLATFORM: 'windows' };

  it('compilation Windows hors audit, pointeur en place : refusée', () => {
    const refus = refusBinairesWindows({ commande: 'build', processus: windows, racine: copie(POINTEUR) });
    expect(refus).toMatch(/^Compilation refusée/);
    expect(refus).toContain('git lfs pull');
  });

  it('pas concernées : autre plateforme, serveur de développement, versions d\'audit', () => {
    const d = copie(POINTEUR);
    expect(refusBinairesWindows({ commande: 'build', processus: { TAURI_ENV_PLATFORM: 'android' }, racine: d })).toBeNull();
    expect(refusBinairesWindows({ commande: 'build', processus: {}, racine: d })).toBeNull();
    expect(refusBinairesWindows({ commande: 'serve', processus: windows, racine: d })).toBeNull();
    expect(refusBinairesWindows({ commande: 'build', processus: { ...windows, NYX_VERSION_AUDIT: '1' }, racine: d })).toBeNull();
  });

  it('vite.config.ts applique ce refus', () => {
    const vite = lire('vite.config.ts');
    expect(vite).toMatch(/refusBinairesWindows\(\{ commande: command, processus: process\.env \}\)/);
  });
});

describe('scripts/windows-release.ps1 : refus à l\'étape 1, avant la clé et la compilation', () => {
  const texte = lire('scripts/windows-release.ps1');

  it('vérifie le lecteur par binaires-natifs.mjs et s\'arrête sur un code non nul', () => {
    expect(texte).toMatch(/\$ErrorActionPreference = 'Continue'\ntry \{ & node \(Join-Path \$root 'scripts\\binaires-natifs\.mjs'\) windows --verifier \}\nfinally \{ \$ErrorActionPreference = 'Stop' \}\nif \(\$LASTEXITCODE -ne 0\) \{\n\s*throw "Compilation refusée[^"]*git lfs pull/);
  });

  it('la vérification précède la demande de la clé et la compilation', () => {
    const verif = texte.indexOf("binaires-natifs.mjs') windows --verifier");
    expect(verif).toBeGreaterThan(-1);
    expect(verif).toBeLessThan(texte.indexOf('--- 2 et 3.'));
    expect(verif).toBeLessThan(texte.indexOf('Read-Host'));
    expect(verif).toBeLessThan(texte.indexOf('& pnpm tauri build'));
  });
});
