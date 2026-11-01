// Carte du bundle de production : quelle part chaque fichier et chaque bibliothèque
// occupe dans les blocs JavaScript chargés par Nyx (audit performance, étape 1).
//
// Aucune dépendance ajoutée : on reconstruit avec la config Vite du projet, on relève
// le code rendu de chaque module (après élimination du code mort), puis on le minifie
// seul pour estimer sa part réelle dans le bloc minifié.
//
// Usage : pnpm perf:bundle   → perf-out/bundle-map.json et perf-out/bundle-map.md

import { build, transformWithEsbuild } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'perf-out');
const buildDir = path.join(outDir, 'bundle-build');

// Code qui ne sert jamais à l'utilisateur en production (panneau de développement, outils).
const DEV_ONLY = [
  /^src\/components\/DevPanel\./,
  /^src\/contexts\/DevOverrideContext\./,
  /^src\/dev\//,
  /^src\/services\/(initDevTools|debugTools|debugCache)\./,
];

const chunks = [];

function collector() {
  return {
    name: 'nyx-bundle-map',
    apply: 'build',
    async generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const modules = [];
        for (const [id, info] of Object.entries(file.modules)) {
          if (!info.code || info.renderedLength === 0) continue;
          const { code } = await transformWithEsbuild(info.code, 'module.js', { minify: true, loader: 'js' });
          modules.push({ id: normalizeId(id), rendered: info.renderedLength, minified: code.length });
        }
        chunks.push({
          fileName: file.fileName,
          isEntry: file.isEntry,
          isDynamicEntry: file.isDynamicEntry,
          size: Buffer.byteLength(file.code),
          gzip: gzipSync(file.code).length,
          modules,
        });
      }
    },
  };
}

function normalizeId(id) {
  const clean = id.replace(/\\/g, '/').replace(/^\0/, '').split('?')[0];
  const nm = clean.lastIndexOf('/node_modules/');
  if (nm !== -1) return 'node_modules/' + clean.slice(nm + '/node_modules/'.length);
  const rel = path.relative(root, clean).replace(/\\/g, '/');
  return rel.startsWith('..') ? clean : rel;
}

function packageOf(id) {
  if (!id.startsWith('node_modules/')) return null;
  const parts = id.slice('node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

// Regroupe par bibliothèque, ou par dossier du code de Nyx (deux niveaux sous src/).
function groupOf(id) {
  const pkg = packageOf(id);
  if (pkg) return `lib: ${pkg}`;
  if (id.startsWith('src/')) {
    const parts = id.split('/');
    return parts.length > 3 ? parts.slice(0, 3).join('/') + '/' : parts.slice(0, 2).join('/');
  }
  return id;
}

const kb = (n) => (n / 1024).toFixed(1) + ' Ko';
const pct = (n, total) => ((100 * n) / total).toFixed(1) + ' %';

function sumBy(modules, keyFn) {
  const map = new Map();
  for (const m of modules) {
    const k = keyFn(m);
    map.set(k, (map.get(k) ?? 0) + m.minified);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function table(rows, total, header) {
  const lines = [`| ${header} | Taille (minifiée, estimée) | Part |`, '|---|---:|---:|'];
  for (const [name, size] of rows) lines.push(`| \`${name}\` | ${kb(size)} | ${pct(size, total)} |`);
  return lines.join('\n');
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  await build({
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'warn',
    plugins: [collector()],
    build: { outDir: buildDir, emptyOutDir: true, chunkSizeWarningLimit: Infinity },
  });

  const entry = chunks.find((c) => c.isEntry);
  if (!entry) throw new Error('Bloc de démarrage introuvable');
  const mods = entry.modules;
  const total = mods.reduce((s, m) => s + m.minified, 0);
  const ours = mods.filter((m) => !packageOf(m.id));
  const devOnly = mods.filter((m) => DEV_ONLY.some((re) => re.test(m.id)));
  const oursTotal = ours.reduce((s, m) => s + m.minified, 0);
  const devTotal = devOnly.reduce((s, m) => s + m.minified, 0);

  const summary = {
    date: new Date().toISOString(),
    chunks: chunks.map(({ modules, ...c }) => ({ ...c, moduleCount: modules.length })),
    entry: {
      fileName: entry.fileName,
      size: entry.size,
      gzip: entry.gzip,
      estimatedModulesTotal: total,
      nyxCode: oursTotal,
      libraries: total - oursTotal,
      devOnly: devTotal,
    },
    groups: sumBy(mods, (m) => groupOf(m.id)),
    packages: sumBy(mods.filter((m) => packageOf(m.id)), (m) => packageOf(m.id)),
    files: [...ours].sort((a, b) => b.minified - a.minified).map((m) => [m.id, m.minified]),
    devOnlyFiles: devOnly.map((m) => [m.id, m.minified]),
  };
  writeFileSync(path.join(outDir, 'bundle-map.json'), JSON.stringify(summary, null, 2));

  const md = [
    '# Carte du bundle de démarrage',
    '',
    `Construit le ${summary.date}. Tailles des modules : estimation (chaque module minifié seul).`,
    '',
    '## Blocs produits',
    '',
    '| Bloc | Chargé | Taille | Compressé (gzip) |',
    '|---|---|---:|---:|',
    ...summary.chunks.map((c) => `| \`${c.fileName}\` | ${c.isEntry ? 'au démarrage' : 'à la demande'} | ${kb(c.size)} | ${kb(c.gzip)} |`),
    '',
    '## Bloc de démarrage',
    '',
    `- Code de Nyx : ${kb(oursTotal)} (${pct(oursTotal, total)})`,
    `- Bibliothèques : ${kb(total - oursTotal)} (${pct(total - oursTotal, total)})`,
    `- Dont code de développement jamais utile en production : ${kb(devTotal)} (${pct(devTotal, total)})`,
    '',
    '## Par bibliothèque ou dossier (25 premiers)',
    '',
    table(summary.groups.slice(0, 25), total, 'Groupe'),
    '',
    '## Fichiers de Nyx les plus lourds (25 premiers)',
    '',
    table(summary.files.slice(0, 25), total, 'Fichier'),
    '',
    '## Code de développement présent au démarrage',
    '',
    table(summary.devOnlyFiles, total, 'Fichier'),
    '',
  ].join('\n');
  writeFileSync(path.join(outDir, 'bundle-map.md'), md);

  console.log(`Bloc de démarrage ${entry.fileName} : ${kb(entry.size)} (gzip ${kb(entry.gzip)})`);
  console.log(`  Nyx ${pct(oursTotal, total)} · bibliothèques ${pct(total - oursTotal, total)} · développement ${pct(devTotal, total)}`);
  console.log('Rapport : perf-out/bundle-map.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
