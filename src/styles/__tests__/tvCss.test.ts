/**
 * Garde-fou de la surcouche Android TV (src/styles/tv.css).
 *
 * Même règle que la couche téléphone : chaque sélecteur doit être limité à `.nyx-tv`,
 * sinon la mise en page bureau et l'APK téléphone héritent des styles TV.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const css = read('src/styles/tv.css').replace(/\/\*[\s\S]*?\*\//g, '');

const preludes = [...css.matchAll(/([^{};]+)\{/g)].map((m) => m[1].trim());
const selectors = preludes
  .filter((p) => !p.startsWith('@'))
  .flatMap((p) => p.split(',').map((s) => s.trim()));

describe('styles/tv.css', () => {
  it('cartes TV : le bouton « + » n\'est jamais flouté, même sur la carte focusée (voile sombre à la place)', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    const flous = blocs.filter((m) => /card-watchlist-btn|watchlist-btn/.test(m[1]) && /backdrop-filter:\s*blur/.test(m[2]));
    expect(flous.map((m) => m[1].trim())).toEqual([]);
    const voile = blocs.find((m) => m[1].split(',').some((x) => x.trim() === '.nyx-tv .watchlist-btn'));
    expect(voile?.[2]).toMatch(/background-color:\s*rgba\(10, 12, 25, 0\.55\)/);
    expect(voile?.[2]).toMatch(/backdrop-filter:\s*none/);
  });

  it('barre latérale TV : aucune transition sur les icônes, le focus ne recalcule pas le style à chaque image', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    for (const sel of ['.nyx-tv .nav-item', '.nyx-tv .nav-icon']) {
      const corps = blocs
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
      expect(corps, sel).toMatch(/transition:\s*none/);
    }
    // Le bureau garde l'animation (la règle commune n'est pas touchée)
    expect(read('src/App.css')).toMatch(/\.nav-item \{[^}]*transition:\s*all/);
  });

  it('cartes TV : le bouton « + », le bandeau d\'infos et le dégradé du haut apparaissent sans fondu (calcul du style à chaque image)', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    for (const sel of [
      '.nyx-tv .carousel-card > .card-watchlist-btn',
      '.nyx-tv .card-watchlist-btn.watchlist-btn',
      '.nyx-tv .carousel-card .card-bottom-bar',
      '.nyx-tv .carousel-card .card-image-wrapper::before',
      '.nyx-tv .category-detail-card .card-top-gradient',
      '.nyx-tv .category-detail-card .card-title-overlay',
    ]) {
      const corps = blocs
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
      expect(corps, sel).toMatch(/transition:\s*none/);
    }
    // Le bureau garde les fondus
    expect(read('src/components/Lists/ContentCarousel.css')).toMatch(/\.card-watchlist-btn \{[^}]*transition:\s*opacity/);
  });

  it('cartes TV : une carte montée apparaît sans fondu d\'entrée (animation de 0,4 s sur le fil principal)', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    const corps = blocs
      .filter((m) => m[1].split(',').some((x) => x.trim() === '.nyx-tv .carousel-card:not(.skeleton)'))
      .map((m) => m[2])
      .join('\n');
    expect(corps).toMatch(/animation:\s*none/);
    // Le bureau garde le fondu
    expect(read('src/components/Lists/ContentCarousel.css')).toMatch(/\.carousel-card:not\(\.skeleton\) \{[^}]*animation:\s*carouselFadeIn/);
  });

  it('cartes TV : une affiche arrive sans fondu (un fondu par affiche servie pendant le défilement coûtait des images perdues)', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    const corps = blocs
      .filter((m) => m[1].split(',').some((x) => x.trim() === '.nyx-tv .carousel-card img'))
      .map((m) => m[2])
      .join('\n');
    expect(corps).toMatch(/transition:\s*none/);
    // Le bureau garde le fondu
    expect(read('src/components/Lists/ContentCarousel.css')).toMatch(/\.carousel-card img \{[^}]*transition:\s*opacity 0\.3s/);
  });

  it('cartes TV : la carte focusée grandit en 120 ms et son bouton Ma liste apparaît en fondu, transform / opacity seulement', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    const transitionOf = (sel: string) =>
      blocs
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => /transition:([^;]+);/.exec(m[2])?.[1].trim())
        .filter(Boolean)
        .pop();
    for (const sel of [':root.nyx-tv .carousel-card:focus', ':root.nyx-tv .channel-card:focus', ':root.nyx-tv .watchlist-card:focus', ':root.nyx-tv .category-detail-card:focus']) {
      expect(transitionOf(sel), sel).toBe('transform 120ms ease-out');
    }
    for (const sel of ['.nyx-tv .carousel-card:focus > .card-watchlist-btn', '.nyx-tv .watchlist-card:focus .card-watchlist-btn', '.nyx-tv .category-detail-card:focus .card-watchlist-btn']) {
      const parts = (transitionOf(sel) ?? '').split(',').map((p) => p.trim());
      expect(parts, sel).toEqual(['opacity 120ms ease-out', 'transform 120ms ease-out']);
    }
    // Aucune transition de taille ou de mise en page dans la surcouche TV
    for (const m of blocs) {
      const t = /transition:([^;]+);/.exec(m[2])?.[1] ?? '';
      expect(t, m[1]).not.toMatch(/\b(all|width|height|top|left|margin|padding)\b/);
    }
  });

  it('contient des règles', () => {
    expect(selectors.length).toBeGreaterThan(5);
  });

  it('ne cadre jamais la page entière : le corps de la page n\'a ni contour ni halo au focus (Chromecast)', () => {
    const bloc = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
      .filter((m) => m[1].split(',').some((x) => x.trim() === ':root.nyx-tv:not(.nyx-pointer) body:focus'))
      .map((m) => m[2])
      .join('\n');
    expect(bloc).toMatch(/outline:\s*none/);
    expect(bloc).toMatch(/box-shadow:\s*none/);
  });

  it('limite chaque sélecteur à la marque .nyx-tv', () => {
    const unscoped = selectors.filter((s) => !s.startsWith(':root.nyx-tv') && !s.startsWith('.nyx-tv'));
    expect(unscoped).toEqual([]);
  });

  it('est importé statiquement par main.tsx, après App.css', () => {
    const main = read('src/main.tsx');
    const appCss = main.indexOf("import './App.css'");
    const tvCss = main.indexOf("import './styles/tv.css'");
    expect(appCss).toBeGreaterThan(-1);
    expect(tvCss).toBeGreaterThan(appCss);
    expect(main).not.toMatch(/import\(\s*['"]\.\/styles\/tv\.css['"]\s*\)/);
  });

  it('coupe en TV le flou du bouton de remise à zéro de la fiche film et le will-change des Similaires', () => {
    // Corps des règles dont la liste de sélecteurs contient exactement `sel`
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    expect(bloc('.nyx-tv .movie-detail-page .reset-progress-btn')).toMatch(/backdrop-filter:\s*none/);
    expect(bloc('.nyx-tv .similar-movies-carousel-container')).toMatch(/will-change:\s*auto/);
  });

  it('resserre en TV les carrousels de l\'accueil, et la hauteur réservée suit', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    // Limité à l'accueil (`.dashboard-content`) : même spécificité que les règles de page, tv.css passe
    // en dernier et écraserait sinon les Similaires de la fiche (margin-bottom: 0)
    expect(bloc('.nyx-tv .dashboard-content .content-carousel')).toMatch(/padding-bottom:\s*1\.5rem/);
    expect(bloc('.nyx-tv .dashboard-content .content-carousel-container')).toMatch(/margin-bottom:\s*var\(--space-2\)/);
    // Base 25 rem (ContentCarousel.css) moins les 1,5 rem gagnés par rangée
    expect(bloc('.nyx-tv .rail .rail-carousel-row')).toMatch(/min-height:\s*23\.5rem/);
    expect(bloc('.nyx-tv .rail .content-carousel-container')).toMatch(/animation:\s*none/);
    expect(bloc('.nyx-tv .content-carousel-container')).toBe('');
    // Communs à tous les carrousels : marges de défilement et espace de fin à droite (voir plus bas) ;
    // aucun espacement vertical ne touche les Similaires
    expect(
      bloc('.nyx-tv .content-carousel').replace(/(scroll-padding-left|scroll-padding-right|padding-right):[^;]+;/g, '').trim()
    ).toBe('');
  });

  // Émulateur et Chromecast : une réduction posée sur body (marge de sécurité de 5 %) faisait
  // couper par la WebView Android tout ce qui débordait du corps dans une boîte de 90 % ancrée en haut
  // à gauche (bannière et carrousels coupés à droite, dernière rangée coupée en bas). Plein écran sur TV :
  // aucune transformation ni zoom sur la page ou ses cadres plein écran ; les retraits sont ciblés.
  it('ne réduit ni ne déplace la page entière (pas de transform ni de zoom sur un cadre plein écran)', () => {
    const fullScreen = /^(:root\.nyx-tv|\.nyx-tv)(\s+(html|body|#root|\.app|\.container|main))?$/;
    const offenders = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
      .filter((m) => m[1].split(',').some((sel) => fullScreen.test(sel.trim())))
      .filter((m) => /(^|;)\s*(transform|zoom|scale|translate)\s*:/.test(m[2]))
      .map((m) => m[1].trim());
    expect(offenders).toEqual([]);
    expect(css).not.toMatch(/--tv-safe-scale|--tv-bleed-/);
  });

  // Chromecast et une télé : la barre latérale, à 3 % du bord, était collée au bord rogné par
  // la télé. Zone sûre d'Android TV : 5 % de chaque bord ; le contenu suit la barre, l'écart reste le même.
  it('place la barre latérale dans la zone sûre de 5 %, le contenu suit et l\'écart barre-contenu ne change pas', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    const racine = bloc(':root.nyx-tv');
    expect(racine).toMatch(/--tv-safe-x:\s*5vw;/);
    expect(racine).toMatch(/--tv-safe-y:\s*5vh;/);
    expect(racine).toMatch(/--sidebar-m:\s*var\(--tv-safe-x\);/);
    expect(racine).toMatch(/--tv-sidebar-gap:\s*3vw;/);
    expect(racine).toMatch(/--sidebar-safe-zone:\s*calc\(var\(--sidebar-w\) \+ var\(--sidebar-m\) \+ var\(--tv-sidebar-gap\)\);/);
    expect(racine).toMatch(/--tv-content-offset:\s*calc\(var\(--tv-sidebar-left\) \+ var\(--tv-sidebar-w\) \+ var\(--tv-sidebar-gap\)\);/);
    // En haut et en bas, la zone sûre verticale (36 px), pas la marge horizontale de la barre (64 px)
    const barre = bloc('.nyx-tv .sidebar');
    expect(barre).toMatch(/top:\s*var\(--tv-safe-y\)/);
    expect(barre).toMatch(/height:\s*calc\(var\(--tv-canvas-h, 100%\) - var\(--tv-safe-y\) \* 2\)/);
    for (const colonne of ['.nyx-tv .tv-categories-sidebar', '.nyx-tv .settings-sidebar']) {
      expect(bloc(colonne)).toMatch(/top:\s*var\(--tv-safe-y\)/);
      expect(bloc(colonne)).toMatch(/bottom:\s*var\(--tv-safe-y\)/);
    }
    expect(bloc('.nyx-tv .live-tv-page')).toMatch(/padding-top:\s*var\(--tv-safe-y\)/);
  });

  // Chromecast : dans tous les carrousels, la dernière carte s'arrêtait au ras du bord droit, que la
  // télé rogne. Elle doit s'arrêter dans la zone sûre : marge de défilement ET place pour y défiler.
  it('arrête la dernière carte de chaque carrousel dans la zone sûre à droite, et écarte Live TV du bord', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    for (const classe of ['.content-carousel', '.tv-carousel-track', '.episodes-carousel']) {
      expect(bloc(`.nyx-tv ${classe}`)).toMatch(/scroll-padding-right:\s*var\(--tv-safe-x\)/);
    }
    // Les règles de page (padding-right: 0 des Similaires et de la Recherche, 4vw des épisodes) sont battues
    for (const sel of [
      '.nyx-tv .content-carousel',
      '.nyx-tv .tv-carousel-track',
      '.nyx-tv .all-results-view .content-carousel',
      '.nyx-tv .similar-movies-carousel-container .content-carousel',
      '.nyx-tv .series-detail-page .episodes-carousel',
    ]) {
      expect(bloc(sel)).toMatch(/padding-right:\s*var\(--tv-safe-x\)/);
    }
    // Rangées du rail de l'accueil (sans padding) : leur piste s'allonge de l'espace de fin
    expect(bloc(':root.nyx-tv')).toMatch(/--carousel-end-space:\s*var\(--tv-safe-x\)/);
    expect(read('src/components/Iptv/rail/railRow.ts')).toContain('+ var(--carousel-end-space, 0px))');
    // Live TV : la grille garde 32 px à droite, la page ajoute le reste de la zone sûre
    expect(read('src/components/Tv/ChannelGrid.tsx')).toMatch(/const RIGHT_PADDING = 32;/);
    expect(bloc('.nyx-tv .live-tv-page')).toMatch(/padding-right:\s*calc\(var\(--tv-safe-x\) - 32px\)/);
  });

  // Chromecast : croix, titre et boutons du lecteur coupés par la télé ; dans le zapping rapide,
  // catégories coupées à gauche et en haut, cartes de chaînes coupées à gauche au focus.
  it('met les commandes du lecteur et le zapping rapide dans la zone sûre, fonds jusqu\'aux bords', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    expect(bloc('.nyx-tv .player-top-bar')).toMatch(/padding:\s*var\(--tv-safe-y\) var\(--tv-safe-x\) 1rem/);
    expect(bloc('.nyx-tv .player-bottom-bar')).toMatch(/padding:\s*0 var\(--tv-safe-x\) var\(--tv-safe-y\)/);
    // La liste d'épisodes reste posée au-dessus de la barre du bas, qui a grandi
    expect(bloc('.nyx-tv .player-overlay')).toMatch(/--player-controls-height:\s*calc\(7rem \+ var\(--tv-safe-y\) - 1rem\)/);
    expect(read('src/App.css')).toMatch(/--player-controls-height:\s*7rem;/);
    // Les barres gardent leur fond : aucun retrait par position (inset, top, left…) qui couperait le voile
    expect(bloc('.nyx-tv .player-top-bar')).not.toMatch(/(^|;|\s)(inset|top|left|right|margin)\s*:/);
    // Zapping : la colonne des catégories s'élargit de la zone sûre où son contenu rentre…
    const colonne = bloc('.nyx-tv .channel-switcher__sidebar');
    expect(colonne).toMatch(/width:\s*calc\(18vw \+ var\(--tv-safe-x\)\)/);
    expect(colonne).toMatch(/min-width:\s*calc\(12rem \+ var\(--tv-safe-x\)\)/);
    expect(colonne).toMatch(/max-width:\s*calc\(16rem \+ var\(--tv-safe-x\)\)/);
    // Retrait sur les textes de chaque bloc, jamais sur la colonne : les fonds des blocs vont jusqu'au bord
    // (sinon la colonne paraît découpée, case détachée du bord de l'écran)
    expect(bloc('.nyx-tv .channel-switcher__sidebar .tv-categories-sidebar')).toBe('');
    expect(bloc('.nyx-tv .channel-switcher__sidebar .tv-categories-sidebar__header')).toMatch(/padding-left:\s*calc\(var\(--tv-safe-x\) \+ var\(--space-5\)\)/);
    expect(bloc('.nyx-tv .channel-switcher__sidebar .tv-categories-sidebar__header')).toMatch(/padding-top:\s*var\(--tv-safe-y\)/);
    for (const zone of ['__fixed', '__scrollable']) {
      expect(bloc(`.nyx-tv .channel-switcher__sidebar .tv-categories-sidebar${zone}`)).toMatch(/padding-left:\s*calc\(var\(--tv-safe-x\) \+ var\(--space-3\)\)/);
    }
    // …et la vidéo se réduit d'autant : même zone sûre côté code (useChannelSwitcher)
    expect(bloc(':root.nyx-tv')).toMatch(/--tv-safe-x:\s*5vw;/);
    expect(read('src/hooks/useChannelSwitcher.ts')).toMatch(/TV_SAFE_X_RATIO = 0\.05;/);
    expect(bloc('.nyx-tv .channel-switcher__grid')).toMatch(/padding-top:\s*var\(--tv-safe-y\)/);
    expect(bloc('.nyx-tv .channel-switcher__grid .channel-grid > div')).toMatch(/padding-left:\s*0\.75rem/);
  });

  // Chromecast : bouton de langue rogné en haut à droite ; connexion et choix du profil collés aux
  // bords haut et bas. Seuls les éléments s'écartent, le fond reste plein écran.
  it('met les écrans d\'entrée (langue, carte de connexion, choix du profil) dans la zone sûre', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    expect(bloc('.nyx-tv .lang-toggle')).toMatch(/top:\s*var\(--tv-safe-y\)/);
    expect(bloc('.nyx-tv .lang-toggle')).toMatch(/right:\s*var\(--tv-safe-x\)/);
    expect(bloc('.nyx-tv .supabase-auth__card')).toMatch(/max-height:\s*calc\(100% - 4 \* var\(--tv-safe-y\)\)/);
    expect(bloc('.nyx-tv .profile-selector__content')).toMatch(/padding:\s*var\(--tv-safe-y\) var\(--tv-safe-x\)/);
    expect(bloc('.nyx-tv .profile-selector__logo')).toMatch(/height:\s*5rem/);
    // Le style en ligne du logo (9 rem) l'emporterait sur tv.css : il n'est pas posé sur TV
    expect(read('src/pages/ProfileSelectorPage.tsx')).toMatch(/style=\{isTv\(\) \? undefined : \{ height: '9rem'/);
    // Jamais de marge sur les pages elles-mêmes, dont le fond doit rester plein écran
    for (const page of ['.nyx-tv .supabase-auth', '.nyx-tv .profile-selector', '.nyx-tv .login-container']) {
      expect(bloc(page)).toBe('');
    }
  });

  // Chromecast : champ de la Recherche décalé à droite et trop haut, bouton retour des fiches trop
  // près du haut, Paramètres un peu collés en haut et à droite.
  it('centre la Recherche sur l\'écran et écarte du haut la Recherche, le retour des fiches et les Paramètres', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    // Même retrait à droite qu'à gauche (GlobalSearchPage.css : padding-left = --sidebar-safe-zone)
    expect(read('src/pages/GlobalSearchPage.css')).toMatch(/\.search-header \{[^}]*padding:[^;]*var\(--sidebar-safe-zone\);/);
    expect(bloc('.nyx-tv .search-header')).toMatch(/padding-right:\s*var\(--sidebar-safe-zone\)/);
    expect(bloc('.nyx-tv .search-header')).toMatch(/padding-top:\s*calc\(var\(--tv-safe-y\) \+ var\(--space-4\)\)/);
    // Le message reste centré sous le champ (vérifié aussi par le banc)
    expect(bloc('.nyx-tv .no-results')).toMatch(/padding-right:\s*var\(--sidebar-safe-zone\)/);
    for (const fiche of ['.nyx-tv .movie-detail-page .back-button', '.nyx-tv .series-detail-page .back-button']) {
      expect(bloc(fiche)).toMatch(/top:\s*var\(--tv-safe-y\)/);
    }
    expect(bloc('.nyx-tv .settings-main')).toMatch(/padding-top:\s*calc\(var\(--tv-safe-y\) \+ var\(--space-4\)\)/);
    expect(bloc('.nyx-tv .settings-main')).toMatch(/padding-right:\s*calc\(var\(--tv-safe-x\) \+ var\(--space-4\)\)/);
  });

  // Chromecast : sur Ma liste, le titre touchait le haut de l'écran et les cartes le bord droit
  it('écarte du haut et du bord droit le contenu de Ma liste', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    expect(bloc('.nyx-tv .watchlist-page')).toMatch(/padding-top:\s*calc\(var\(--tv-safe-y\) \+ var\(--space-4\)\)/);
    expect(bloc('.nyx-tv .watchlist-page')).toMatch(/padding-right:\s*calc\(var\(--tv-safe-x\) \+ var\(--space-4\)\)/);
    // Le retrait gauche reste celui de la barre latérale (WatchlistPage.css), pas de marge de plus
    expect(bloc('.nyx-tv .watchlist-page')).not.toMatch(/padding(-left)?:/);
  });

  // Le haut et le bas du cadre de focus étaient rognés (Recherche, Live TV)
  it('laisse la place du cadre de focus dans les rangées de la Recherche et la grille de Live TV', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    // Piste de la Recherche : marge verticale plus grande que les 0,5 rem d'origine, compensée
    expect(bloc('.nyx-tv .tv-carousel-track')).toMatch(/padding-block:\s*0\.875rem/);
    expect(bloc('.nyx-tv .tv-carousel-track')).toMatch(/margin-block:\s*-0\.375rem/);
    // Bord droit : la dernière carte n'est plus collée (zone sûre, test plus bas)
    expect(bloc('.nyx-tv .tv-carousel-track')).toMatch(/padding-right:\s*var\(--tv-safe-x\)/);
    // Live TV : plus de fondu transparent en haut de la grille
    const grille = bloc('.nyx-tv .channel-grid > div');
    // 1re rangée : ≥ 11,3 px de place au-dessus de la carte (banc), soit 0,75 rem (18 px de rem)
    expect(grille).toMatch(/padding-top:\s*0\.75rem/);
    expect(grille).not.toMatch(/margin-top/);
    // Sans repère positionné, les cellules absolues de react-window ignorent le padding (constaté par sonde)
    expect(bloc('.nyx-tv .channel-grid > div > div')).toMatch(/position:\s*relative/);
    expect(grille).not.toMatch(/transparent 0%/);
    expect(grille).toMatch(/mask-image:\s*linear-gradient\(to bottom, black 0%/);
  });
  describe('carrousels défilants : la vue suit la carte sans la laisser sous la barre latérale', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    const bloc = (sel: string) =>
      blocs
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');

    // Accueil, Similaires de la fiche film, résultats « Voir tout » : content-carousel ; Recherche : piste ;
    // fiche série : épisodes
    it.each(['.content-carousel', '.tv-carousel-track', '.episodes-carousel'])('%s', (classe) => {
      expect(bloc(`.nyx-tv ${classe}`)).toMatch(/scroll-padding-left:\s*var\(--sidebar-safe-zone\)/);
    });

    it('aucun autre conteneur à défilement horizontal n\'est oublié', () => {
      const sources = readdirSync(resolve(process.cwd(), 'src'), { recursive: true, encoding: 'utf8' })
        .filter((f) => f.endsWith('.css') && !f.includes('mobile') && !f.includes('tv.css'));
      const trouves = new Set<string>();
      for (const f of sources) {
        const source = read(`src/${f}`).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of source.matchAll(/([^{};]+)\{([^}]*overflow-x:\s*(?:scroll|auto)[^}]*)\}/g)) {
          for (const sel of m[1].split(',')) {
            const classes = sel.match(/\.[a-z][\w-]*/g);
            if (classes) trouves.add(classes[classes.length - 1]);
          }
        }
      }
      // Exceptions : conteneurs à défilement horizontal qui ne sont pas des carrousels de cartes
      // (ajouter ici avec sa raison)
      const exceptions = new Set<string>([]);
      const couverts = new Set(['.content-carousel', '.tv-carousel-track', '.episodes-carousel', ...exceptions]);
      const oublies = [...trouves].filter((c) => !couverts.has(c));
      expect(oublies).toEqual([]);
    });
  });

  it('barre latérale TV : voile sombre sans flou, le verre dépoli a fait perdre en fluidité sur la Chromecast', () => {
    const bloc = (sel: string) =>
      [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)]
        .filter((m) => m[1].split(',').some((x) => x.trim() === sel))
        .map((m) => m[2])
        .join('\n');
    const barre = bloc('.nyx-tv .sidebar');
    expect(barre).toMatch(/background:\s*rgba\(12, 12, 20, 0\.82\)/);
    expect(barre).toMatch(/(?<!-webkit-)backdrop-filter:\s*none/);
    expect(barre).toMatch(/-webkit-backdrop-filter:\s*none/);
  });

  it('fiches film et série : le logo titre reste visible après son fondu d\'entrée', () => {
    // Le logo est un enfant de `.main-layer`, qui démarre à opacité 0 et ne reste visible que grâce à
    // `animation-fill-mode: forwards` de la règle de page. Un raccourci `animation: …` sur le logo remet
    // ce mode à `none` : tv.css passant après le CSS des pages à spécificité égale, le logo s'affichait
    // 0,3 s puis repassait à 0 sur TV. Seul le nom de l'animation flottante est coupé.
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    for (const page of ['.movie-detail-page', '.series-detail-page']) {
      const corps = blocs
        .filter((m) => m[1].split(',').some((x) => x.trim().startsWith(`.nyx-tv ${page}`) && /\.detail-logo\b/.test(x)))
        .map((m) => m[2])
        .join('\n');
      expect(corps, page).toMatch(/animation-name:\s*none/);
      expect(corps, page).not.toMatch(/(^|[\s;])animation\s*:/);
      expect(corps, page).not.toMatch(/animation-fill-mode/);
    }
  });

  it('fiches film et série : le contenu commence sous la flèche Retour', () => {
    const blocs = [...css.matchAll(/([^{};]+)\{([^}]*)\}/g)];
    for (const page of ['.movie-detail-page', '.series-detail-page']) {
      const corps = blocs
        .filter((m) => m[1].split(',').some((x) => x.trim() === `.nyx-tv ${page} .detail-layout`))
        .map((m) => m[2])
        .join('\n');
      expect(corps, page).toMatch(/padding-top:\s*calc\(var\(--tv-safe-y\)\s*\+\s*4rem/);
    }
  });
});
