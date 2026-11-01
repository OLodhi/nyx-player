// Vercel garde chaque déploiement d'aperçu (environ 9 Mo pour web/) et le plan gratuit plafonne ce
// stockage à 10 Go. Choix retenu : plus aucun aperçu, seule la production (main) se
// déploie ; un aperçu se rallume à la main le jour où il sert vraiment.
// Deux verrous : « git.deploymentEnabled » ne crée de déploiement que pour main, et « ignoreCommand »
// saute toute compilation hors production si le premier laisse passer une branche.
// Convention Vercel : sortie 0 = compilation sautée, 1 = compilation lancée, tout autre code = erreur.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const config = JSON.parse(readFileSync(path.join(web, 'vercel.json'), 'utf8'));

// Sous Windows, `sh` n'est pas toujours dans le PATH : ces cas sont alors sautés plutôt que faussés.
const hasSh = spawnSync('sh', ['-c', 'exit 0'], { stdio: 'ignore' }).status === 0;

// Lance la commande comme Vercel, avec l'environnement de déploiement donné.
function run(vercelEnv) {
  const env = { ...process.env, VERCEL_ENV: vercelEnv };
  if (vercelEnv === undefined) delete env.VERCEL_ENV;
  const result = spawnSync('sh', ['-c', config.ignoreCommand], { env, stdio: 'ignore' });
  if (result.error) throw result.error;
  return result.status;
}

describe('web/vercel.json : seule la production se déploie sur Vercel', () => {
  it('ne crée de déploiement que pour la branche main', () => {
    // `**` couvre aussi les noms de branche avec « / » (claude/…) ; main l'emporte car une règle
    // vraie suffit à Vercel pour déployer.
    expect(config.git.deploymentEnabled).toEqual({ '**': false, main: true });
  });

  it.skipIf(!hasSh)('compile toujours la production', () => {
    expect(run('production')).toBe(1);
  });

  it.skipIf(!hasSh)('saute tout aperçu, même quand le site change', () => {
    expect(run('preview')).toBe(0);
  });

  it.skipIf(!hasSh)('saute aussi sans environnement connu, sans jamais rendre d’erreur', () => {
    expect(run(undefined)).toBe(0);
  });
});
