# Nyx Player — CSS Patterns

> Recettes CSS réutilisables. Chaque pattern = une combinaison de tokens à appliquer ensemble.
> Complète `DESIGN_TOKENS.md` (valeurs isolées) et `BRAND_SYSTEM.md` (identité visuelle).
>
> **Workflow** : 🔴 Draft → 🟡 Validé → 🟢 Appliqué (tokenisé ou unifié dans le code)

---

## 1. Page Layout (post-login)

- **Type** : 📄 Doc only (les tokens existent déjà, c'est la règle d'usage qui manque)
- **Statut** : 🟡 Validé
- **Usage** : Toutes les pages affichées après login (Dashboard, Watchlist, Settings, LiveTV, etc.)
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-page`

### Recette

```css
.ma-page {
  min-height: 100vh;
  background: transparent;                      /* Le nebula du body est visible */
  color: var(--text-primary);
  padding: var(--space-8) var(--space-10) var(--space-8) var(--sidebar-safe-zone);
  overflow-y: auto;
  animation: pageFadeIn var(--duration-slow) var(--ease-out) both;
}
```

### Règles
- `padding-left` = **toujours** `var(--sidebar-safe-zone)` pour décaler le contenu à droite de la sidebar
- `background: transparent` — jamais de fond opaque, le nebula du `body` doit rester visible
- `min-height: 100vh` — la page occupe toujours au moins tout l'écran

### Exceptions connues
- **Dashboard** : `padding-left: 0` — les carousels sont edge-to-edge (dépassent sous la sidebar par design). Le `--sidebar-safe-zone` est appliqué sur les **titres de section** uniquement.
- **Settings** : utilise `calc(var(--tv-sidebar-left) + var(--tv-sidebar-w) + 2rem)` — double sidebar (sidebar principale + sidebar settings).
- **LiveTV** : même cas que Settings — double sidebar (sidebar principale + sidebar catégories TV).
- **GlobalSearch** : `padding: 0` sur le container — le `--sidebar-safe-zone` est appliqué sur les éléments internes (search header, carousel titles, tracks) pour permettre le scroll edge-to-edge.
- **MovieDetail / SeriesDetail** : les carousels de recommandations/épisodes sont edge-to-edge (pas de padding), le reste du contenu respecte le safe-zone.

### Incohérences actuelles
- ⚠️ Chaque page utilise des valeurs de padding top/right/bottom différentes (space-7, space-8, space-10…)

---

## 2. Page Layout (pré-login)

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Les 3 pages sans sidebar : Xtream Login, ProfileSelector, SupabaseAuth
- **Référence actuelle** : `ProfileSelectorPage.css` → `.profile-selector`

### Recette

```css
.ma-page-centered {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;   /* défaut recommandé — permet le scroll si contenu > viewport */
  width: 100%;
  background: transparent;
  animation: pageFadeIn var(--duration-slow) var(--ease-out) both;
}
```

### Règles
- Centrage flex dans les deux axes
- `min-height: 100vh` (ou `height: 100vh` si le contenu ne doit jamais scroller)
- Pas de sidebar, pas de `--sidebar-safe-zone`
- Fond transparent (nebula visible)

### Note
- SupabaseAuth applique l'animation sur la **card** (pas le container) car le container est invisible. Aucune des deux approches n'est fausse — le fade-in doit être visible sur le premier élément opaque.

---

## 3. Page Header

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Titre + sous-info en haut de page post-login — **optionnel**, la plupart des pages n'affichent pas de titre visible (Dashboard, LiveTV, GlobalSearch, Settings, Detail pages). Utile principalement pour Watchlist et futures pages avec header.
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-header` + `.watchlist-title`

### Recette

```css
.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-8);
}

.page-title {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  font-family: var(--font-display);
  background: linear-gradient(to bottom, var(--text-primary) 30%, var(--text-muted) 100%);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: var(--leading-tight);
}

.page-subtitle {
  font-size: var(--text-sm);
  font-family: var(--font-body);
  color: var(--text-muted);
  font-weight: var(--font-regular);
}
```

### Règles
- Titre = `--text-4xl` + `--font-display` + gradient blanc→muted
- Sous-titre optionnel (ex: "12 éléments") en `--text-sm` muted
- `margin-bottom: --space-8` entre le header et le contenu

### Incohérences actuelles
- ⚠️ Certaines pages n'utilisent pas le gradient sur le titre
- ⚠️ Tailles de titre variables (--text-2xl vs --text-4xl)

---

## 4. Page Fade-In

- **Type** : ✅ Tokenisable → `@keyframes pageFadeIn` dans `App.css`
- **Statut** : 🟡 Validé
- **Usage** : Animation d'entrée des pages naviguées via la sidebar (Watchlist, Dashboard, etc.)
- **Référence actuelle** : `WatchlistPage.css` → `@keyframes watchlistFadeIn`
- **Hors scope** : les transitions MovieDetail/SeriesDetail (navigation par card) et le transition overlay du player (`mainUiFadeIn`) ont leurs propres animations, non concernées par ce pattern.

### Recette

```css
/* À mettre dans App.css — une seule fois */
@keyframes pageFadeIn {
  from {
    opacity: 0;
    transform: translateY(0.5rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Utilisation** : `animation: pageFadeIn var(--duration-slow) var(--ease-out) both;`

### Incohérences actuelles
- ⚠️ `watchlistFadeIn` : `translateY(0.625rem)` — quasi identique au pattern (0.5rem vs 0.625rem)
- ⚠️ `profileFadeIn` : `scale(0.97)` au lieu de `translateY` — effet différent
- ⚠️ `searchPageFadeIn` : `translateY(0.5rem)` — identique au pattern ✅
- ⚠️ `authCardFadeIn` : `translateY(1.5rem) scale(0.97)` — **composite** (translate + scale combinés)
- ⚠️ `settingsContentFadeIn` : `translateY(10px)` — utilise des `px` !
- → Tout sera remplacé par `pageFadeIn` une fois validé, sauf si un effet spécifique est voulu

---

## 5. Glass Card

- **Type** : ✅ Tokenisable → classe `.glass-card` dans `App.css`
- **Statut** : 🟡 Validé
- **Usage** : Cards, login-box, panneaux de contenu
- **Référence actuelle** : `App.css` → `.login-box`

### Recette

```css
.glass-card {
  background: var(--surface-raised);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
}
```

### Variantes

| Niveau | Background | Blur | Shadow | Usage |
|--------|-----------|------|--------|-------|
| **Light** | `--glass-bg-light` | `--glass-blur` | `--shadow-sm` | Sidebar, éléments subtils |
| **Medium** (défaut) | `--surface-raised` | `--glass-blur` | `--shadow-md` | Cards, panneaux |
| **Heavy** | `--glass-bg-heavy` | `--glass-blur-strong` | `--shadow-xl` | Login-box, overlays |
| **Modal** | `--surface-modal` (`#12121a`, opaque) | aucun | — | Modales (CategoryManager, ConfirmModal) — fond opaque, pas de glass |

### Incohérences actuelles
- ⚠️ La sidebar utilise `rgba(15, 15, 20, 0.25)` directement au lieu de `--glass-bg-light`
- ⚠️ Certaines cards n'ont pas de `box-shadow`

---

## 6. Scrollbar

- **Type** : ✅ Tokenisable → classe `.scrollbar-thin` dans `App.css`
- **Statut** : 🟡 Validé
- **Usage** : Tout élément scrollable qui doit afficher une scrollbar visible
- **Référence actuelle** : `TvCategoriesSidebar.css` → `.tv-categories-sidebar__pinned-list`

### Recette

```css
.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}

.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}

.scrollbar-thin::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

.scrollbar-thin::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.25);
}
```

**Pour masquer la scrollbar** : `scrollbar-width: none` (déjà utilisé sur Dashboard, carousels)

### Incohérences actuelles
- ⚠️ Scrollbar définie dans **8+ fichiers** avec des opacités différentes :
  - SupabaseAuthPage : `0.08` (ultra-discret)
  - TvCategoriesSidebar : `0.15`
  - SeriesDetailPage : `0.2`
  - MovieDetailPage : `0.2` et `0.3`
  - SettingsCarousels : `0.2`
- → À unifier sur `0.15` (la valeur la plus discrète tout en restant visible)

---

## 7. Grid Responsive (poster cards)

- **Type** : 📄 Doc only (chaque page peut adapter les valeurs du `clamp()`)
- **Statut** : 🟡 Validé
- **Usage** : Grilles de poster cards (watchlist, résultats de recherche, etc.)
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-grid`

### Recette

```css
.poster-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, clamp(9.5rem, 12vw, 13rem));
  gap: var(--space-6);
  justify-content: start;
  align-items: start;
}
```

### Règles
- `clamp(min, preferred, max)` — adapte la taille des colonnes au viewport
- `auto-fill` — autant de colonnes que possible
- `gap: --space-6` — espace standard entre cards
- ⚠️ Ce pattern est une **référence**, pas une obligation. Certaines grilles (Dashboard, IPTV) ont leur propre layout.

---

## 8. Card Hover (lift + glow)

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Effet hover sur les poster cards et cards cliquables
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-card:hover`

### Recette

```css
.ma-card {
  cursor: pointer;
  transition:
    transform var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out),
    border-color var(--duration-normal) var(--ease-out);
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: var(--surface-raised);
  border: 1px solid var(--border-subtle);
}

.ma-card:hover {
  transform: translateY(-0.5rem) scale(1.03);
  box-shadow: 0 0.5rem 2rem rgba(0, 0, 0, 0.4);
  border-color: var(--border-strong);
  z-index: var(--z-dropdown);
}
```

### Note
- Le `box-shadow` glow coloré (rouge/bleu) est optionnel selon le contexte
- `z-index: --z-dropdown` permet à la card survolée de passer au-dessus de ses voisines

---

## 9. Skeleton Shimmer

- **Type** : ✅ Tokenisable → `@keyframes shimmer` dans `App.css`
- **Statut** : 🟡 Validé
- **Usage** : Animation de chargement sur les squelettes de contenu
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-skeleton-card__poster`

### Recette

```css
/* Animation — à mettre dans App.css une seule fois */
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Appliquer sur n'importe quel bloc skeleton */
.skeleton-block {
  background: linear-gradient(
    110deg,
    rgba(255, 255, 255, 0.03) 30%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.03) 70%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s linear infinite;
}
```

### Règles
- Chaque page définit son propre **layout de skeleton** (positions, tailles des blocs)
- Mais le `@keyframes shimmer` et le `background` gradient sont **toujours les mêmes**
- `animation-delay` en stagger (0s, 0.2s, 0.4s…) pour un effet naturel

---

## 10. Empty State

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Quand une page/section n'a pas de contenu à afficher
- **Référence actuelle** : `WatchlistPage.css` → `.watchlist-empty-state`

### Recette

```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 50vh;
  text-align: center;
  animation: pageFadeIn var(--duration-slow) var(--ease-out) both;
}

/* Icône flottante */
.empty-state__icon {
  width: 5rem;
  height: 5rem;
  margin-bottom: var(--space-6);
  opacity: 0.4;
  color: var(--text-muted);
}

/* Titre */
.empty-state h2 {
  font-size: var(--text-2xl);
  font-weight: var(--font-semibold);
  font-family: var(--font-display);
  margin-bottom: var(--space-3);
  color: var(--text-primary);
}

/* Description */
.empty-state p {
  font-size: var(--text-base);
  color: var(--text-muted);
  max-width: 25rem;
  line-height: var(--leading-relaxed);
  margin-bottom: var(--space-7);
}

/* CTA → utiliser <NyxButton> */
```

### Composition
1. Icône (SVG, emoji, ou illustration) — taille 5rem, opacity 0.4
2. Titre (`--text-2xl`, display)
3. Description (`--text-base`, muted, max-width 25rem)
4. CTA optionnel (`<NyxButton>`)

---

## 11. Error Banner

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Affichage inline d'une erreur (peu d'endroits : auth/login pages, settings)

### Variante A — Banner avec retry (pages)

- **Référence** : `WatchlistPage.css` → `.watchlist-error`
- **Contexte** : erreur de chargement de données, bouton retry à droite

```css
.error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-6);
  background: var(--color-error-subtle);
  backdrop-filter: var(--glass-blur);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-7);
  animation: pageFadeIn 0.25s var(--ease-out) both;
}

.error-banner__message {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--color-error);
}

.error-banner__retry {
  padding: var(--space-2) var(--space-4);
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
```

### Variante B — Banner form avec shake (formulaires)

- **Référence** : `SupabaseAuthPage.css` → `.supabase-auth__error` / `App.css` → `.login-error`
- **Contexte** : erreur de validation dans un formulaire, icône ⚠ à gauche, animation shake

```css
.form-error {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
  background: rgba(239, 68, 68, 0.08);
  border: 0.0625rem solid rgba(239, 68, 68, 0.15);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  line-height: 1.5;
  word-break: break-word;
}

.form-error::before {
  content: '⚠';
  flex-shrink: 0;
  font-size: var(--text-base);
}
```

### Quand utiliser quelle variante ?
- **Variante A** : erreurs de données/réseau sur une page → bouton retry, fond `--color-error-subtle`, glass
- **Variante B** : erreurs de validation dans un formulaire → icône ⚠, shake, fond plus discret

---

## 12. Form Group

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Groupe label + input dans les formulaires
- **Référence actuelle** : `App.css` → `.form-group`

### Recette

```css
.form-group {
  margin-bottom: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-group label {
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-family: var(--font-body);
}

.form-group input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background-color: var(--nyx-dark);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  font-family: var(--font-body);
  transition: border-color var(--duration-fast) var(--ease-out),
              box-shadow var(--duration-fast) var(--ease-out);
}

.form-group input:focus {
  outline: none;
  border-color: rgba(40, 40, 163, 0.6);
  box-shadow: 0 0 0 0.1875rem rgba(40, 40, 163, 0.15);
}
```

### Règles
- Label en uppercase, `--text-xs`, muted
- Input avec fond `--nyx-dark`, border subtle
- Focus = border nyx-blue + glow subtil

### Incohérences actuelles
- ⚠️ Settings utilise `.edit-field` avec `background: var(--hover-overlay)` et `border: var(--border-strong)` au lieu de `var(--nyx-dark)` / `var(--border-subtle)` — look différent voulu (inline edit) ou à unifier ?

---

## 13. Responsive (breakpoints desktop)

- **Type** : 📄 Doc only
- **Statut** : 🟡 Validé
- **Usage** : Ajustements par résolution d'écran
- **Référence actuelle** : `WatchlistPage.css` lignes 396-419

### Breakpoints

| Cible | Media query | Base font-size |
|-------|------------|----------------|
| Laptop 13"-15" | `@media (max-width: 1366px)` | 14px |
| Desktop FHD (défaut) | pas de query | 16px |
| QHD / Ultrawide | `@media (min-width: 2560px)` | 17px |

### Ajustements standard par breakpoint

**Laptop (≤ 1366px)** :
```css
@media (max-width: 1366px) {
  .ma-page {
    padding: var(--space-7) var(--space-7) var(--space-7) var(--sidebar-safe-zone);
  }
  .page-title {
    font-size: var(--text-2xl);  /* Réduit de 4xl à 2xl */
  }
}
```

**Ultrawide (≥ 2560px)** :
```css
@media (min-width: 2560px) {
  .ma-page {
    padding: var(--space-9) var(--space-10) var(--space-9) var(--sidebar-safe-zone);
  }
}
```

### Règles
- Le `font-size` du `html` change déjà via `App.css` (14px → 16px → 17px), donc tous les `rem` scalent automatiquement
- Les media queries dans les pages ajustent **padding et tailles de titre** uniquement
- ⚠️ À vérifier page par page quelles pages implémentent déjà ces breakpoints

---

## Résumé des tokenisations

> ✅ Toutes appliquées dans `App.css` (section "REUSABLE PATTERNS", lignes ~199-265).

| Pattern | Classe/Keyframe | Statut |
|---------|----------------|--------|
| Page Fade-In | `@keyframes pageFadeIn` | 🟢 Appliqué |
| Glass Card | `.glass-card` | 🟢 Appliqué |
| Scrollbar | `.scrollbar-thin` | 🟢 Appliqué |
| Shimmer | `@keyframes shimmer` + `.skeleton-block` | 🟢 Appliqué |
