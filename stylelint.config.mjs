// Règlement CSS de Nyx Player, vérifié à chaque modification (`pnpm lint:css`, CI GitHub).
// Pourquoi chaque règle, et les exceptions : docs/CSS_RULES.md.
//
// Le CSS existant est gelé dans stylelint-suppressions.json : seules les nouvelles alertes échouent.
// Une exception ponctuelle s'écrit avec sa raison, sinon elle est refusée :
//   /* stylelint-disable-next-line defensive-css/no-fixed-sizes -- affiche TMDB au ratio fixe */
export default {
  extends: ['stylelint-config-recommended'],
  plugins: ['stylelint-plugin-defensive-css', 'stylelint-no-unsupported-browser-features'],
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  reportInvalidScopeDisables: true,
  rules: {
    // Les surcouches .nyx-mobile / .nyx-tv surchargent volontairement des sélecteurs plus spécifiques du bureau.
    'no-descending-specificity': null,

    // Priorités : spécificité ou surcouche de plateforme, jamais !important.
    'declaration-no-important': true,

    // Survol collé après un toucher sur téléphone, sans objet à la télécommande.
    'defensive-css/no-accidental-hover': true,
    // Tailles encadrées plutôt que fixes. Les points de rupture en px restent autorisés (CONVENTIONS.md).
    'defensive-css/no-fixed-sizes': [true, { 'at-rules': { '@media': false, '@container': false } }],
    // Le focus doit se voir au clavier et à la télécommande.
    'defensive-css/require-focus-visible': true,
    // 100vh ment sur téléphone (barres du navigateur, clavier).
    'defensive-css/require-dynamic-viewport-height': [true, { severity: 'error' }],
    // Un conteneur flex déclare s'il passe à la ligne : c'est la cause des libellés écrasés des Paramètres.
    'defensive-css/require-flex-wrap': true,
    'defensive-css/require-grid-minmax': true,
    // Fenêtres et listes qui défilent : la page derrière ne doit pas défiler avec.
    'defensive-css/require-overscroll-behavior': true,
    'defensive-css/require-background-repeat': true,
    'defensive-css/require-system-font-fallback': true,
    'defensive-css/no-unsafe-clamp-font-size': true,
    'defensive-css/no-unsafe-will-change': true,
    'defensive-css/no-mixed-vendor-prefixes': true,

    // WebView minimale visée : Chrome 90, box Android TV 9+ à jour, Fire TV,
    // Chromecast. Seul un support totalement absent bloque : les supports partiels (masques doublés
    // de -webkit-, barres de défilement stylées) sont tolérés, voir docs/CSS_RULES.md.
    'plugin/no-unsupported-browser-features': [true, {
      browsers: ['Chrome >= 90', 'ChromeAndroid >= 90'],
      ignorePartialSupport: true,
    }],
  },
  overrides: [
    {
      // Toile TV fixe de 1280 × 720 mise à l'échelle de l'écran : le pixel y est la bonne unité.
      // Focus : la télécommande ne produit pas toujours `:focus-visible` dans la WebView, d'où `:focus`
      // sous `:not(.nyx-pointer)` (pas de cadre après un clic souris, voir tv.css).
      files: ['src/styles/tv.css'],
      rules: {
        'defensive-css/no-fixed-sizes': null,
        'defensive-css/require-focus-visible': null,
      },
    },
  ],
};
