# Nyx Player — Design Tokens

> Tronc commun de design. Toutes les valeurs visuelles réutilisables sont définies ici.
> Complète `BRAND_SYSTEM.md` (palette, typos, logos) avec les tokens d'implémentation CSS.

---

## 1. Couleurs sémantiques

> Les couleurs brand (`--nyx-red`, `--nyx-blue`, `--nyx-dark`) sont dans `BRAND_SYSTEM.md`.
> Ici : les couleurs **fonctionnelles** utilisées dans l'UI.

### Tokens CSS (à ajouter dans `:root`)

```css
:root {
  /* ── Brand core (cf. BRAND_SYSTEM.md) ── */
  --nyx-dark:        #020a19;
  --nyx-blue:        #2828a3;
  --nyx-red:         #681717;

  /* ── Brand étendu (kit UI v2) ── */
  --nyx-blue-light:  #5e6fea;                           /* Bleu clair — boutons accent */
  --nyx-red-dark:    #330000;                           /* Rouge sombre — fonds/dégradés */
  --nyx-purple:      #350033;                           /* Pourpre — dégradé nebula */
  --nyx-violet:      #4a4ad0;                           /* Violet brand — gradient "reimagined" */
  --nyx-violet-dark: #8080e0;                           /* Violet clair — pôle light du gradient */
  --nyx-violet-subtle: rgba(74, 74, 208, 0.06);         /* Form bg, sections légères violet */
  --nyx-violet-border: rgba(74, 74, 208, 0.15);         /* Form border violet */

  /* ── Fond ── */
  --surface-base:    var(--nyx-dark);                   /* Alias sémantique → --nyx-dark (#020a19) */
  --surface-raised:  rgba(15, 15, 20, 0.45);           /* Cards, modals (glass) */
  --surface-overlay: rgba(0, 0, 0, 0.6);               /* Overlays, backdrops */
  --surface-modal:   rgba(25, 28, 45, 0.8);             /* Modals — slate bleuté + glass-blur */
  --surface-whisper: rgba(255, 255, 255, 0.03);         /* Surfaces ultra-légères (tab containers, section bg) */

  /* ── Bordures ── */
  --border-subtle:   rgba(255, 255, 255, 0.06);        /* Séparateurs discrets */
  --border-default:  rgba(255, 255, 255, 0.10);        /* Bordures standard */
  --border-strong:   rgba(255, 255, 255, 0.20);        /* Bordures accentuées (hover) */

  /* ── Texte ── */
  --text-primary:    #ffffff;                           /* Titres, labels principaux */
  --text-secondary:  #c9d1d9;                           /* Corps de texte */
  --text-muted:      #8b949e;                           /* Captions, hints */
  --text-disabled:   rgba(255, 255, 255, 0.3);          /* Éléments désactivés */
  --text-icon:       rgba(255, 255, 255, 0.4);          /* Icônes & éléments interactifs secondaires */

  /* ── Statut / Feedback ── */
  --color-success:   #46d369;                           /* Validation, confirmations */
  --color-error:     #ef4444;                           /* Erreurs, destructif */
  --color-warning:   #f59e0b;                           /* Avertissements */
  --color-info:      #58a6ff;                           /* Information, liens, accents */

  /* ── Statut hover/active ── */
  --color-success-subtle: rgba(70, 211, 105, 0.15);
  --color-error-subtle:   rgba(239, 68, 68, 0.15);
  --color-warning-subtle: rgba(245, 158, 11, 0.15);
  --color-info-subtle:    rgba(88, 166, 255, 0.15);
  --color-error-bg:       rgba(239, 68, 68, 0.08);     /* Form error bg (plus subtil que -subtle) */
  --color-success-bg:     rgba(70, 211, 105, 0.08);     /* Form success bg (symétrique de error-bg) */

  /* ── Interaction ── */
  --focus-ring:      rgba(40, 40, 163, 0.4);            /* Outline focus (nyx-blue) */
  --focus-border:    rgba(40, 40, 163, 0.6);            /* Bordure focus inputs */
  --nyx-blue-subtle: rgba(40, 40, 163, 0.2);            /* Active state tabs/éléments brand */
  --nyx-blue-hover:  rgba(40, 40, 163, 0.3);            /* Hover state éléments brand actifs */
  --hover-overlay:   rgba(255, 255, 255, 0.06);         /* Fond survol */
  --active-overlay:  rgba(255, 255, 255, 0.10);         /* Fond clic/actif */
}
```

### Règle d'utilisation

| Besoin | Token |
|--------|-------|
| Fond d'une page | `--surface-base` |
| Fond d'une card / modal | `--surface-raised` + `backdrop-filter` |
| Fond d'un overlay sombre | `--surface-overlay` |
| Titre / label important | `--text-primary` |
| Paragraphe courant | `--text-secondary` |
| Sous-texte, hint | `--text-muted` |
| Badge "succès" | `color: --color-success`, `background: --color-success-subtle` |
| Badge "erreur" | `color: --color-error`, `background: --color-error-subtle` |

---

## 2. Typographie

### Échelle de tailles (kit UI v2)

> Base : `1rem = 16px` sur FHD (1920×1080), `14px` sur ≤1366px, `17px` sur ≥2560px.
> Déjà configuré dans `App.css` via `html { font-size }` + media queries.
> On peut utiliser `clamp()` ponctuellement si un élément a besoin d'une échelle fluide (hero titles).

#### Headlines — Space Grotesk Bold

| Token CSS | Valeur | Kit UI | Usage |
|-----------|--------|--------|-------|
| `--text-5xl` | `3.5rem` | H1 (56px) | Hero, titres majeurs |
| `--text-4xl` | `2.5rem` | H2 (40px) | Titres de page |
| `--text-2xl` | `1.75rem` | H3 (28px) | Titres de section |
| `--text-xl` | `1.25rem` | H4 (20px) | Sous-titres |

#### Body — Inter

| Token CSS | Valeur | Kit UI | Usage |
|-----------|--------|--------|-------|
| `--text-lg` | `1.125rem` | Body 1 (18px) | Texte principal, paragraphes |
| `--text-base` | `1rem` | Body 2 (16px) | Texte standard, inputs, labels |
| `--text-sm` | `0.8125rem` | Body 3 (13px) | Captions, sous-labels, liens secondaires |
| `--text-xs` | `0.75rem` | Body 4 (12px) | Badges, labels uppercase, footer legal |

#### Boutons — Inter Medium (`<NyxButton>`)

| Token CSS | Valeur | Kit UI | Usage |
|-----------|--------|--------|-------|
| `--text-btn` | `1.25rem` | Button Default (20px) | Boutons medium |
| `--text-btn-sm` | `1.125rem` | Button Small (18px) | Boutons small |

> **Padding validé** : medium `0.625rem 2.8rem`, small `0.5rem 1.25rem`
> **Radius** : primary = `--radius-md` (0.5rem), secondary = `--radius-pill` (2rem)
> **Composant** : `src/components/Common/NyxButton.tsx` — cf. `BRAND_SYSTEM.md §3` pour la liste complète

### Graisses

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--font-regular` | `400` | Corps de texte (Body 1, Body 2) |
| `--font-medium` | `500` | Labels, navigation, boutons |
| `--font-semibold` | `600` | Boutons, sous-titres (usage interne) |
| `--font-bold` | `700` | Titres (H1–H4), Body gras |

### Line-heights

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--leading-tight` | `1.2` | Titres, headings |
| `--leading-normal` | `1.5` | Corps de texte |
| `--leading-relaxed` | `1.6` | Blocs de texte long, descriptions |

### Règles typographiques

- **Titres (h1–h4)** : `font-family: var(--font-display)` (Space Grotesk), `font-weight: var(--font-bold)`
- **Tout le reste** : `font-family: var(--font-body)` (Inter)
- **Ne jamais** utiliser de `font-size` en `px` hardcodé (utiliser les tokens)
- **Corps de texte** : minimum `--text-base` (`1rem`) pour la lisibilité desktop
- **Boutons** : `font-family: var(--font-body)`, `font-weight: var(--font-medium)`

---

## 3. Espacement

### Échelle de spacing (base 4px = 0.25rem)

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--space-1` | `0.25rem` | Micro-gaps (badge padding, icon margin) |
| `--space-2` | `0.5rem` | Gaps internes compacts (entre label et input) |
| `--space-3` | `0.75rem` | Padding boutons, petites cartes |
| `--space-4` | `1rem` | Gap standard entre éléments |
| `--space-5` | `1.25rem` | Gap navigation, items de liste |
| `--space-6` | `1.5rem` | Padding de sections, marges de blocs |
| `--space-8` | `2rem` | Séparation de groupes (sections) |
| `--space-10` | `2.5rem` | Marges de page, grands espaces |
| `--space-12` | `3rem` | Séparations majeures |
| `--space-16` | `4rem` | Hero, espaces extra-larges |

### Règles d'espacement

- **Éléments liés** (label + input) : `--space-2` ou `--space-3`
- **Éléments dans un groupe** (items de liste) : `--space-4` ou `--space-5`
- **Groupes séparés** (sections d'une page) : `--space-8` à `--space-12`
- **Nouveaux composants** : utiliser les tokens ci-dessus (grille 4px, multiples de `0.25rem`)
- **Migration du code existant** : les valeurs legacy (ex: `0.375rem`, `0.625rem`) seront remplacées au fur et à mesure — pas de réécriture en bloc

---

## 4. Border-radius

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--radius-sm` | `0.25rem` | Tags, badges, chips |
| `--radius-md` | `0.5rem` | Boutons, inputs, dropdowns |
| `--radius-lg` | `0.75rem` | Cards, modales, panneaux |
| `--radius-xl` | `1rem` | Cards larges, sections |
| `--radius-2xl` | `1.5rem` | Éléments hero, sidebar glass |
| `--radius-full` | `50%` | Avatars, dots, icônes rondes |
| `--radius-pill` | `2rem` | Toggle switches, boutons pill |

### Règles

- **Ne jamais** utiliser `border-radius` en `px` (ex: `12px`, `3px`)
- **Chaque composant** doit utiliser un token — pas de valeur inline arbitraire
- **Hiérarchie** : plus l'élément est grand, plus son radius est grand

---

## 5. Ombres & Élévation

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--shadow-sm` | `0 2px 8px rgba(0, 0, 0, 0.2)` | Dropdowns, tooltips |
| `--shadow-md` | `0 4px 16px rgba(0, 0, 0, 0.3)` | Cards flottantes |
| `--shadow-lg` | `0 8px 32px rgba(0, 0, 0, 0.4)` | Modales, popups |
| `--shadow-xl` | `0 12px 48px rgba(0, 0, 0, 0.6)` | Overlays majeurs, sidebar hover |
| `--shadow-glow` | `0 0 20px rgba(40, 40, 163, 0.4)` | Glow nyx-blue (focus, CTA) |
| `--shadow-glow-red` | `0 0 20px rgba(229, 9, 20, 0.4)` | Glow rouge (actif, danger) |

---

## 6. Transitions & Animations

### Durées

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--duration-fast` | `150ms` | Hover, toggle, micro-feedback |
| `--duration-normal` | `250ms` | Animations standards (fade, slide) |
| `--duration-slow` | `400ms` | Transitions de page, révélations |
| `--duration-slower` | `600ms` | Animations décoratives (nebula) |

### Easings

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--ease-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard Material — usage par défaut (hover, entrées, la plupart des transitions) |
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Entrées ludiques (scale-up, popups) |
| `--ease-spring` | `cubic-bezier(0.4, 0, 0.2, 1.2)` | Rebonds subtils (overshoot léger) |

> **Note** : Si un ease-in-out symétrique est nécessaire (rare), utiliser `ease-in-out` CSS natif.

### Transition standard

```css
/* Exemple : tout transition avec le timing standard */
.element {
  transition: all var(--duration-normal) var(--ease-out);
}

/* Hover uniquement */
.element:hover {
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}
```

---

## 7. Glass / Glassmorphism

> L'app utilise intensivement des surfaces glass. Standardiser les niveaux.

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--glass-bg-light` | `rgba(15, 15, 20, 0.25)` | Sidebar, éléments subtils |
| `--glass-bg-medium` | `rgba(15, 15, 20, 0.45)` | Cards, panneaux |
| `--glass-bg-heavy` | `rgba(15, 15, 20, 0.7)` | Modales, overlays |
| `--glass-blur` | `blur(12px) saturate(160%)` | Blur standard |
| `--glass-blur-strong` | `blur(24px) saturate(180%)` | Blur fort (modales) |

> **Note** : Pour la bordure glass, utiliser `--border-subtle` (section 1). Pas de token `--glass-border`
> séparé car une variable CSS ne peut pas contenir une shorthand `border` complète utilisable avec `var()`.

---

## 8. Z-Index

> Échelle prédéfinie pour éviter les conflits de superposition.

| Token CSS | Valeur | Usage |
|-----------|--------|-------|
| `--z-base` | `1` | Contenu normal (#root) |
| `--z-dropdown` | `100` | Dropdowns, tooltips |
| `--z-sticky` | `200` | Headers sticky, barres fixes |
| `--z-sidebar` | `1000` | Sidebar principale |
| `--z-modal` | `1100` | Modales, popups |
| `--z-overlay` | `1200` | Overlays (transition player) |
| `--z-toast` | `1300` | Toasts, notifications |
| `--z-devpanel` | `9999` | DevPanel (dev uniquement) |

---

## 9. Breakpoints (référence, pas des tokens CSS)

> App desktop Tauri — les breakpoints ciblent les résolutions d'écran courantes.
> ⚠️ Ce ne sont **pas** des variables CSS (les media queries n'acceptent pas `var()`).
> Ils sont documentés ici comme **référence** pour la cohérence.

| Nom | Valeur | Cible |
|-----|--------|-------|
| Laptop | `1366px` | Laptops 13"-15" |
| Desktop FHD | `1920px` | Base de design (styles par défaut) |
| Ultrawide | `2560px` | QHD / Ultrawide |

### Usage en media queries

```css
/* Laptop (plus petit) */
@media (max-width: 1366px) { }

/* Desktop FHD = styles par défaut (pas de query) */

/* Grands écrans */
@media (min-width: 2560px) { }
```

---

## 10. Do / Don't

### ✅ Do

| Règle | Pourquoi |
|-------|----------|
| Utiliser les tokens pour toute valeur visuelle | Cohérence + maintenance facile |
| Unités relatives (`rem`, `%`, `vh`, `vw`) | Responsive natif |
| `clamp()` pour font-size si besoin d'échelle fluide | Pas de media queries pour les tailles |
| `backdrop-filter` pour les surfaces glass | Identité Nyx Player |
| `gap` dans flex/grid au lieu de `margin` sur les enfants | Plus propre, plus maintenable |
| `min-height: 0` sur les conteneurs flex | Prévient les overflow involontaires |
| Transitions sur hover/focus | Feedback visuel immédiat |

### ❌ Don't

| Règle | Pourquoi |
|-------|----------|
| `px` hardcodés pour spacing/font-size/radius | Casse le responsive, incohérent |
| Couleurs hex brutes dans les composants | Utiliser les tokens sémantiques |
| `position: absolute` pour le layout principal | Superpositions, pas de flow |
| `!important` (sauf cas rares documentés) | Dette technique, impossible à override |
| `z-index` arbitraires (ex: `999`, `50`) | Utiliser l'échelle prédéfinie |
| Blanc pur `#ffffff` sur grands blocs de texte | Trop agressif — réserver aux titres courts |
| `margin-top` + `margin-bottom` combinés sur le même élément | Préférer `gap` ou direction unique (exception : `margin-block`) |

---

## 11. Migration depuis les variables legacy

> `App.css` contient des variables marquées "Legacy" qui seront migrées progressivement.

| Variable legacy | Token de remplacement | Statut |
|-----------------|----------------------|--------|
| `--bg-color` | `--surface-base` | 🔴 À migrer |
| `--bg-main` | `--surface-base` | 🔴 À migrer |
| `--text-color` | `--text-secondary` | 🔴 À migrer |
| `--text-primary` | `--text-primary` (identique) | ✅ OK |
| `--accent-color` | `--color-info` (⚠️ à valider : accent ≠ info dans certains contextes) | 🔴 À migrer |
| `--primary-color` | *supprimer* (Netflix red, plus pertinent, remplacé par nyx-blue/red) | 🔴 À migrer |
| `--series-color` | token dédié ou `--color-info` (à décider pendant refonte) | 🔴 À migrer |
| `--success-color` | `--color-success` | 🔴 À migrer |
| `--card-bg` | `--surface-raised` | 🔴 À migrer |
| `--glass-bg` | `--glass-bg-medium` | 🔴 À migrer |
| `--glass-border` | via `--border-subtle` | 🔴 À migrer |

> ⚠️ La migration se fera **page par page** pendant la Phase 2, pas en bloc.
