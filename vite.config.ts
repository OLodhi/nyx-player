/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { configDefaults } from 'vitest/config';
import { refusBinairesWindows, refusPublication } from './scripts/garde-publication.mjs';

const host = process.env.TAURI_DEV_HOST;

// ---------------------------------------------------------------------------
// Plugin: move Vite-injected <script>/<link> from <head> to end of <body>.
// Without this, the 175 KB CSS bundle blocks the first paint of #app-loader
// in production builds, causing a flash instead of the loading screen.
// ---------------------------------------------------------------------------
function moveAssetsAfterLoader(): import('vite').Plugin {
  return {
    name: 'move-assets-after-loader',
    enforce: 'post',
    transformIndexHtml(html) {
      // Only operate on production builds (dev serves modules on-demand)
      const scriptRe = /<script\s+type="module"\s+crossorigin\s+src="[^"]+"><\/script>\n?/g;
      const linkRe = /<link\s+rel="stylesheet"\s+crossorigin\s+href="[^"]+"\s*\/?>\n?/g;

      const scripts = html.match(scriptRe) || [];
      const links = html.match(linkRe) || [];

      if (scripts.length === 0 && links.length === 0) return html;

      // Remove from <head>
      let result = html;
      for (const tag of [...scripts, ...links]) {
        result = result.replace(tag, '');
      }

      // Re-inject just before </body> (after #app-loader and the show-window script)
      const injection = '  ' + [...links, ...scripts].map(t => t.trim()).join('\n  ') + '\n';
      result = result.replace('</body>', injection + '</body>');

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin: refuse a code-split chunk that carries its own CSS.
// Its stylesheet would be injected after tv.css at runtime and win over the TV and
// phone overlays at equal specificity. Lazy pages import their CSS statically from
// src/components/lazyPages.ts instead, so the single CSS file keeps its order.
// ---------------------------------------------------------------------------
function forbidLazyChunkCss(): import('vite').Plugin {
  return {
    name: 'forbid-lazy-chunk-css',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || file.isEntry) continue;
        const css = file.viteMetadata?.importedCss;
        if (css && css.size > 0) {
          this.error(
            `Le bloc chargé à la demande ${file.fileName} apporte son propre CSS (${[...css].join(', ')}). ` +
            'Importer ce fichier CSS dans src/components/lazyPages.ts, à sa place dans la liste.',
          );
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async ({ command, mode }) => {
  // Garde-fou de publication : jamais de version publiée en mode audit ou banc (scripts/garde-publication.mjs)
  const refus = refusPublication({ commande: command, vite: loadEnv(mode, process.cwd(), 'VITE_'), processus: process.env });
  if (refus) throw new Error(refus);
  // Compilation Windows : le vrai lecteur mpv.exe, pas un pointeur Git LFS
  const refusLecteur = refusBinairesWindows({ commande: command, processus: process.env });
  if (refusLecteur) throw new Error(refusLecteur);
  return {
  plugins: [react(), moveAssetsAfterLoader(), forbidLazyChunkCss()],
  // Mode preview dans une vraie WebView Tauri (DEV) : cf. src/dev/preview/tauriCoreShim.ts
  resolve: process.env.NYX_PREVIEW === '1'
    ? {
        alias: [
          {
            find: /^@tauri-apps\/api\/core$/,
            replacement: fileURLToPath(new URL('./src/dev/preview/tauriCoreShim.ts', import.meta.url)),
          },
        ],
      }
    : undefined,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // 5 s (défaut de vitest) trop juste sur le PC de la CI locale, suite complète en parallèle : les mêmes
    // tests y prennent 3 à 4 fois plus qu'à vide (« reprise après un rechargement » 1,7 s seul,
    // 5,1 à 7 s en suite ; « Échap déclenche la pile de retour » 0,13 s seul, 5,1 s en suite). Mesuré sur
    // deux versions du code : durée identique (114 s la suite, mêmes temps par test), aucun code en cause.
    // Un test réellement bloqué échoue toujours, après 20 s.
    testTimeout: 20000,
    // Copies de travail des sessions parallèles (.claude/worktrees/*, dans le dossier du dépôt) :
    // sans cette exclusion, leurs tests étaient ramassés aussi et la suite restait bloquée.
    // Sorties de compilation Rust et Android (des Go de fichiers) : même blocage dans une copie où
    // l'APK a été compilé, comme celle de la CI sur le PC.
    exclude: [...configDefaults.exclude, '**/.claude/**', 'src-tauri/target/**', 'src-tauri/gen/**'],
    // Valeurs factices : supabaseClient.ts refuse de se charger sans elles, et un test ne doit
    // jamais joindre le vrai Supabase (elles priment sur les variables du poste).
    env: {
      VITE_SUPABASE_URL: 'https://example.invalid',
      VITE_SUPABASE_ANON_KEY: 'test-placeholder',
    },
    // Couverture : `pnpm test:coverage`, en rapport seulement (aucun seuil bloquant pour l'instant).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
};
});
