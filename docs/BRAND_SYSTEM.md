# Nyx Player — Brand System

> Source de vérité unique pour l'identité visuelle. Chaque section est validée manuellement.

---

## 1. Palette de couleurs

### Couleurs core (logo)

| Token CSS | Hex | RVB | Rôle |
|---|---|---|---|
| `--nyx-red` | `#681717` | 104, 23, 23 | Rouge marque — dégradé fond app |
| `--nyx-blue` | `#2828A3` | 40, 40, 163 | Bleu marque — dégradé fond app, boutons primaires |
| `--nyx-dark` | `#020A19` | 2, 10, 25 | Fond principal de l'app |

### Couleurs étendues (kit UI v2)

| Token CSS | Hex | RVB | Rôle |
|---|---|---|---|
| `--nyx-blue-light` | `#5E6FEA` | 94, 111, 234 | Bleu clair — boutons accent, variante lighter du bleu marque |
| `--nyx-red-dark` | `#330000` | 51, 0, 0 | Rouge très sombre — fonds/dégradés boutons rouges |
| `--nyx-purple` | `#350033` | 53, 0, 51 | Pourpre — utilisé dans le dégradé nebula entre bleu et rouge |

### Règles d'utilisation

- **Fond app** : `--nyx-dark` (`#020A19`) — couleur solide de base
- **Dégradés fond** : le rouge et le bleu de marque + le pourpre servent de source pour les effets nebula/ambiance
- **Boutons primaires** : `--nyx-blue` (principal), `--nyx-blue-light` (accent), `--nyx-red` (danger/destructif)
- **Fonds boutons rouges** : `--nyx-red-dark` pour les backgrounds sombres

---

## 2. Typographies

Les deux polices (licence OFL) sont **hébergées avec le site** dans `web/assets/fonts` (polices variables Fontsource, `@font-face` en tête de `web/styles.css`) : ne pas réintroduire Google Fonts, la CSP de `web/vercel.json` le bloque (`font-src 'self'`) et la politique de confidentialité ne le mentionne plus.

| Token CSS | Police | Usage | Graisses utilisées |
|---|---|---|---|
| `--font-display` | **Space Grotesk** | Titres (h1, h2, h3, h4) | Bold (700) |
| `--font-body` | **Inter** | Corps de texte, labels, UI, boutons | Regular (400), Medium (500), Bold (700) |

### Échelle typographique officielle (kit UI v2)

#### Headlines — Space Grotesk Bold

| Niveau | Taille (px) | Taille (rem) | Usage |
|--------|------------|-------------|-------|
| Headlines 1 | 56px | 3.5rem | Hero, titres majeurs |
| Headlines 2 | 40px | 2.5rem | Titres de page |
| Headlines 3 | 28px | 1.75rem | Titres de section |
| Headlines 4 | 20px | 1.25rem | Sous-titres |

#### Body — Inter

| Niveau | Taille (px) | Taille (rem) | Weight | Usage |
|--------|------------|-------------|--------|-------|
| Body 1 | 18px | 1.125rem | Regular (400) | Texte principal, paragraphes |
| Body 1 gras | 18px | 1.125rem | Bold (700) | Emphasis, labels importants |
| Body 2 | 16px | 1rem | Regular (400) | Texte standard, inputs |
| Body 2 gras | 16px | 1rem | Bold (700) | Labels, navigation |

#### Boutons — Inter Medium

| Niveau | Taille (px) | Taille (rem) | Line-height | Usage |
|--------|------------|-------------|-------------|-------|
| Button Default | 20px | 1.25rem | 24px (1.5rem) | Boutons medium |
| Button Small | 18px | 1.125rem | — | Boutons small |

### Fichiers des polices

`web/assets/fonts/` : `inter-latin-wght-normal.woff2`, `inter-latin-ext-wght-normal.woff2`,
`space-grotesk-latin-wght-normal.woff2`, `space-grotesk-latin-ext-wght-normal.woff2` (Fontsource 5.3.0),
avec leurs licences. Test : `scripts/test/site-polices.test.mjs`.

---

## 3. Système de boutons — `<NyxButton>`

> Composant : `src/components/Common/NyxButton.tsx`

### Boutons validés (8 au total)

#### Primary — background plein, `border-radius: 0.5rem`

| Couleur | Fill | Texte | Tailles |
|---------|------|-------|---------|
| **Blue** | gradient `#2828A3` → `rgba(40,40,163,0.75)` | blanc | Medium, Small |
| **Blue Light** | gradient `#5E6FEA` → `rgba(94,111,234,0.75)` | blanc | Medium, Small |
| **Red** | gradient `#681717` → `rgba(104,23,23,0.75)` | blanc | Medium, Small |

#### Secondary — contour dégradé pill, fond `--nyx-dark`

| Couleur | Contour | Texte | Tailles |
|---------|---------|-------|---------|
| **Blue** | gradient `#2828A3` → `#681717` (gauche→droite) | blanc | Medium, Small |

> Le secondary utilise `border-radius: 2rem` (pill) et la technique `background-clip: padding-box / border-box`.

### Tailles

| Taille | Font-size | Padding | Usage |
|--------|-----------|---------|-------|
| **Medium** | `1.25rem` (20px) | `0.625rem 2.8rem` | CTA, actions principales |
| **Small** | `1.125rem` (18px) | `0.5rem 1.25rem` | Actions secondaires, inline |

### Props du composant

```tsx
<NyxButton
  variant="primary|secondary"   // défaut: primary
  size="medium|small"            // défaut: medium
  color="blue|blue-light|red"    // défaut: blue (secondary: blue uniquement)
  iconLeft={<Icon />}            // optionnel
  iconRight={<Icon />}           // optionnel
  fullWidth                      // optionnel — width: 100%
/>
```

### Layouts (position de l'icône)

- **Label seul** : `Button`
- **Label + icône droite** : `Button +`
- **Icône gauche + label** : `+ Button`

---

## 4. Logotypes

**Dossier source** : `docs/Nyx Player branding/LOGOTYPES/`

Chaque logo existe en **4 déclinaisons** (Blanc, Bleu, Noir, Rouge) en SVG et PNG.

| Logo | Aperçu | Usage dans l'app | Variante recommandée |
|---|---|---|---|
| **Principal** (horizontal : icotype + texte) | `LOGO PRINCIPAL/` | **Loading screen** (splash démarrage) | Blanc sur fond `--nyx-dark` |
| **Secondaire** (vertical : icotype au-dessus du texte) | `LOGO SECONDAIRE/` | **Page de login**, **About**, **Settings** | Bleu sur fond sombre |
| **Icotype** (symbole "N" seul) | `ICOTYPE/` | **Sidebar** (remplace le carré rouge), **favicon** | Blanc |
| **Logo App** (icotype + fond arrondi) | `LOGO APP/` | **Icône Tauri** (exe Windows, barre des tâches) | Bleu ou Dégradé |

---

## 5. Pictogrammes — Table de mapping

**Pictos disponibles** : `docs/Nyx Player branding/PICTO/SVG/` (36 fichiers, style **fill**, blanc `#fff`)

> Remplis la colonne **Picto Nyx** au fur et à mesure. Mets `—` si aucun picto ne correspond (il faudra le demander ou le garder tel quel).

### Sidebar (style actuel : stroke)

| # | Icône app | Fichier source | Picto Nyx |
|---|---|---|---|
| 1 | 🏠 Home (dashboard) | `Sidebar.tsx` | *(à mapper)* |
| 2 | 🔍 Recherche | `Sidebar.tsx` | *(à mapper)* |
| 3 | 📺 Live TV | `Sidebar.tsx` | *(à mapper)* |
| 4 | ⭐ Watchlist | `Sidebar.tsx` | *(à mapper)* |
| 5 | ⚙️ Settings | `Sidebar.tsx` | *(à mapper)* |
| 6 | 🚪 Logout | `Sidebar.tsx` | *(à mapper)* |

### Player (style actuel : fill, dans `PlayerIcons.tsx`)

| # | Icône app | Composant | Picto Nyx |
|---|---|---|---|
| 7 | ▶ Play | `PlayIcon` | *(à mapper)* |
| 8 | ⏸ Pause | `PauseIcon` | *(à mapper)* |
| 9 | 🔊 Volume haut | `VolumeHighIcon` | *(à mapper)* |
| 10 | 🔉 Volume bas | `VolumeLowIcon` | *(à mapper)* |
| 11 | 🔇 Volume muet | `VolumeMuteIcon` | *(à mapper)* |
| 12 | ⛶ Plein écran | `FullscreenIcon` | *(à mapper)* |
| 13 | ⛶ Sortir plein écran | `ExitFullscreenIcon` | *(à mapper)* |
| 14 | 💬 Audio/Sous-titres | `AudioSubIcon` | *(à mapper)* |
| 15 | ✓ Check | `CheckIcon` | *(à mapper)* |
| 16 | ⏪ Recul 10s | `SkipBackwardIcon` | *(à mapper)* |
| 17 | ⏩ Avance 10s | `SkipForwardIcon` | *(à mapper)* |
| 18 | ⏮ Épisode précédent | `PrevEpisodeIcon` | *(à mapper)* |
| 19 | ⏭ Épisode suivant | `NextEpisodeIcon` | *(à mapper)* |
| 20 | 🔒 Lock | `LockIcon` | *(à mapper)* |
| 21 | 🔓 Unlock | `UnlockIcon` | *(à mapper)* |

### Pages (SVG inline divers)

| # | Icône app | Où | Picto Nyx |
|---|---|---|---|
| 22 | ← Retour (chevron) | `MovieDetailPage`, `SeriesDetailPage` | *(à mapper)* |
| 23 | ▼ Chevron dropdown | `SeriesDetailPage` (saison) | *(à mapper)* |
| 24 | + Ajouter watchlist | `MovieDetailPage`, `SeriesDetailPage` | *(à mapper)* |
| 25 | ✓ Dans watchlist | `MovieDetailPage`, `SeriesDetailPage` | *(à mapper)* |
| 26 | 🔄 Reset progression | `MovieDetailPage`, `SeriesDetailPage` | *(à mapper)* |

### Pictos Nyx Player non utilisés (dans le branding mais pas encore mappés)

Les pictos suivants existent dans le dossier branding mais n'ont pas encore de correspondance dans l'app :

`cast.svg`, `en boucle.svg`, `épingle.svg`, `film.svg`, `info.svg`, `menu.svg`, `bulle.svg`, `Fichier 72.svg`, `retlj.svg`

---

## 6. Règles de style

> ⏳ En attente — à compléter
