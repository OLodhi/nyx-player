// @vitest-environment node
// L'app Windows n'accepte une mise à jour que si chaque signature
// de latest.json a été faite pour la version annoncée (src-tauri/src/app_update.rs). Le test Rust qui
// le vérifie sur le fichier publié ne tourne que dans la vérification Rust des PR ; celui-ci rejoue la
// même règle dans `pnpm verify`, à chaque envoi. Une erreur ici = aucune app ne se mettrait à jour.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const lire = (relatif) => readFileSync(fileURLToPath(new URL(`../../${relatif}`, import.meta.url)), 'utf8');
const brut = lire('web/updates/latest.json');
const appUpdate = lire('src-tauri/src/app_update.rs');
const prefixe = appUpdate.match(/const INSTALLER_PREFIX: &str = "([^"]+)";/)?.[1];

// Nom du fichier signé : 3e ligne seulement (commentaire couvert par la signature), comme l'app
function fichierSigne(signature) {
  const lignes = Buffer.from(signature.trim(), 'base64').toString('utf8').split('\n');
  const commentaire = lignes[2]?.replace(/\r$/, '');
  if (!commentaire?.startsWith('trusted comment: ')) return null;
  const champ = commentaire.slice('trusted comment: '.length).split('\t').find((c) => c.startsWith('file:'));
  return champ ? champ.slice('file:'.length) : null;
}

const signePour = (signature, version) => {
  const fichier = fichierSigne(signature);
  return Boolean(fichier?.startsWith(prefixe) && fichier.slice(prefixe.length).startsWith(`${version}_`));
};

describe('web/updates/latest.json', () => {
  it('se lit (pas de BOM, JSON valide)', () => {
    expect(brut.charCodeAt(0)).not.toBe(0xfeff);
    expect(() => JSON.parse(brut)).not.toThrow();
  });

  it('chaque plateforme est signée pour la version annoncée, et servie depuis R2', () => {
    const { version, platforms } = JSON.parse(brut);
    expect(prefixe).toBe('Nyx Player_');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const entrees = Object.entries(platforms ?? {});
    expect(entrees.length).toBeGreaterThan(0);
    for (const [plateforme, { signature, url }] of entrees) {
      expect(signePour(signature, version), plateforme).toBe(true);
      expect(url, plateforme).toMatch(/^https:\/\/releases\.nyxplayer\.app\//);
    }
  });

  it('la règle refuse une version annoncée qui n\'est pas celle signée', () => {
    const { version, platforms } = JSON.parse(brut);
    const signature = platforms['windows-x86_64'].signature;
    // Version X.Y.Z signée : ni 9.9.9, ni X.Y.Z0, ni X.Y ne passent
    expect(signePour(signature, version)).toBe(true);
    expect(signePour(signature, '9.9.9')).toBe(false);
    expect(signePour(signature, `${version}0`)).toBe(false);
    expect(signePour(signature, version.split('.').slice(0, 2).join('.'))).toBe(false);
  });
});
