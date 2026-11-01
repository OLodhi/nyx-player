---
name: Nyx Player
description: Lecteur IPTV nocturne, cinéma et premium, pour Windows, téléphone Android et Android TV
colors:
  nyx-night: "#020A19"
  nyx-red: "#681717"
  nyx-blue: "#2828A3"
  nyx-blue-light: "#5E6FEA"
  nyx-red-dark: "#330000"
  nyx-purple: "#350033"
  nyx-violet: "#4A4AD0"
  text-primary: "#FFFFFF"
  text-secondary: "#C9D1D9"
  text-muted: "#8B949E"
  success: "#46D369"
  error: "#EF4444"
  warning: "#F59E0B"
  info: "#58A6FF"
typography:
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 700
    lineHeight: 1.2
  headline:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
  subtitle:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  body-large:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "Roboto Mono, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
rounded:
  xs: "0.125rem"
  sm: "0.25rem"
  md: "0.5rem"
  lg: "0.75rem"
  xl: "1rem"
  2xl: "1.5rem"
  pill: "2rem"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
  "12": "3rem"
  "16": "4rem"
components:
  button-primary-blue:
    backgroundColor: "{colors.nyx-blue}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.625rem 2.8125rem"
  button-primary-blue-light:
    backgroundColor: "{colors.nyx-blue-light}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.625rem 2.8125rem"
  button-primary-red:
    backgroundColor: "{colors.nyx-red}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.625rem 2.8125rem"
  button-secondary:
    backgroundColor: "{colors.nyx-night}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: "0.625rem 2.8125rem"
  poster-card:
    rounded: "{rounded.lg}"
    width: "clamp(9.5rem, 13vw, 15.625rem)"
---

# Design System: Nyx Player

Source des valeurs : `src/App.css` (`:root`), `src/components/Common/NyxButton.css`, mini-charte
d'origine de la marque (PDF, hors dépôt), et [`docs/BRAND_SYSTEM.md`](docs/BRAND_SYSTEM.md).
Règles CSS vérifiées automatiquement : [`docs/CSS_RULES.md`](docs/CSS_RULES.md).

## 1. Overview

**Creative North Star: "La salle obscure"**

Nyx Player se regarde comme on entre dans une salle de cinéma : la nuit tombe (#020A19), seules
les affiches et l'écran sont éclairés, et la lumière de la marque (un halo rouge sombre, un halo
bleu profond, une touche pourpre) baigne les bords comme les veilleuses d'une salle. L'interface
se tient en retrait : surfaces de verre fumé, textes blancs et gris clair, peu de couleur vive.
Le premium vient de la retenue et de la fluidité, pas de l'accumulation d'effets.

Le système rejette le look des lecteurs IPTV classiques (listes et grilles surchargées), le style
gaming / néon (lueurs saturées) et l'aspect d'outil administratif. Il emprunte à Netflix ses
repères d'ergonomie (bannière, carrousels) et à Plex / Infuse la mise en valeur d'une
bibliothèque, sans copier leur marque.

Trois mises en page pour une même identité : bureau Windows (souris), téléphone (surcouche
`.nyx-mobile`, 320 à 480 points de large) et TV (surcouche `.nyx-tv`, toile 1280 × 720 mise à
l'échelle de l'écran, télécommande).

**Key Characteristics:**
- Fond nuit uni, éclairé par un dégradé « nébuleuse » rouge-bleu-pourpre très atténué.
- Surfaces en verre fumé (`backdrop-filter`) plutôt qu'en aplats opaques.
- Affiches au ratio 2:3 et images de fond comme matière principale de l'écran.
- Couleurs de marque réservées aux actions et aux états actifs.
- Liseré de focus bleu clair, net, toujours visible au clavier et à la télécommande.

## 2. Colors: La palette de la nuit

Une nuit presque noire, deux lumières de marque profondes, et un bleu clair réservé à l'action.

### Primary
- **Bleu Nyx** (#2828A3) : boutons principaux, onglet ou élément actif (à 20–30 % d'opacité), halo
  du fond. Pôle froid du dégradé de marque.
- **Bleu lumière** (#5E6FEA) : accent d'action et **liseré de focus** (`--focus-ring-color`).
  La seule couleur vive de l'interface.

### Secondary
- **Rouge Nyx** (#681717) : pôle chaud du dégradé de marque, boutons destructifs (supprimer, se
  déconnecter). Un rouge sombre, de velours, jamais un rouge vif.
- **Rouge profond** (#330000) : fonds des boutons rouges et des zones d'alerte sombres.

### Tertiary
- **Pourpre** (#350033) et **violet** (#4A4AD0) : transition entre le bleu et le rouge dans les
  dégradés « nébuleuse » ; le violet sert aussi aux fonds de formulaires très légers (6 %).

### Neutral
- **Nuit Nyx** (#020A19) : fond de l'app sur toutes les plateformes.
- **Blanc** (#FFFFFF) : titres et texte principal.
- **Gris lune** (#C9D1D9) : texte secondaire.
- **Gris brume** (#8B949E) : texte discret, métadonnées.
- Bordures et surfaces : blanc à 3–20 % d'opacité (`--border-*`, `--surface-*`), verre fumé
  `rgba(15, 15, 20, 0.25 à 0.7)`.
- États : succès #46D369, erreur #EF4444, avertissement #F59E0B, information #58A6FF, toujours
  accompagnés d'un texte ou d'une icône.

### Named Rules
**La règle de la veilleuse.** Les couleurs de marque éclairent, elles n'inondent pas : dégradés
de fond à 30 % d'opacité au plus, et une seule action colorée pleine par zone d'écran.

**La règle du rouge sombre.** Le rouge de Nyx est #681717. Le rouge vif #E50914 (`--primary-color`,
hérité d'une première version) est hors charte : ne plus l'utiliser dans du code nouveau.

## 3. Typography

**Display Font:** Space Grotesk (repli : sans-serif)
**Body Font:** Inter (repli : sans-serif)
**Label/Mono Font:** Roboto Mono (repli : Consolas, monospace), pour les statistiques et les durées

**Character:** Space Grotesk donne aux titres une géométrie un peu technique, qui fait écho au
logo ; Inter porte tout le reste avec une lisibilité neutre. Les deux polices sont livrées dans
l'app (`@fontsource`), le rendu ne dépend pas de l'appareil.

### Hierarchy
- **Display** (700, 3.5rem, 1.2) : bannière d'accueil, titres de fiche.
- **Headline** (700, 2.5rem, 1.2) : titres de page.
- **Title** (700, 1.75rem, 1.2) : titres de section, noms de carrousel.
- **Subtitle** (700, 1.25rem, 1.2) : sous-titres.
- **Body** (400, 1rem, 1.5) : texte courant ; **Body large** (400, 1.125rem) pour les synopsis.
- **Label** (500, 0.875rem) : libellés, options, métadonnées.
- Base de taille (racine) : 16 px, ramenée à 14 px sous 1366 px de large et portée à 17 px au-delà
  de 2560 px ; 18 px sur TV (lecture à 3 mètres, toile mise à l'échelle).

### Named Rules
**La règle des deux voix.** Space Grotesk pour ce qui se lit comme un titre (et les boutons
`NyxButton`), Inter pour tout ce qui se lit comme du texte. Pas de troisième police, sauf les
chiffres techniques en Roboto Mono.

## 4. Elevation

La profondeur vient d'abord de la **transparence** : surfaces de verre fumé posées sur le fond
nébuleuse (`--glass-bg-light` à `--glass-bg-heavy`, flou 12 à 24 px), bordures blanches à peine
visibles. Les ombres sont sombres, douces et diffuses, jamais dures ; certains boutons portent une
ombre teintée de leur couleur.

### Shadow Vocabulary
- **Légère** (`box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2)`) : éléments posés.
- **Moyenne** (`box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3)`) : menus, boutons principaux (teintée).
- **Forte** (`box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4)`) : fenêtres.
- **Maximale** (`box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6)`) : lecteur, calques plein écran.
- **Halo bleu** (`box-shadow: 0 0 20px rgba(40, 40, 163, 0.4)`) : mise en valeur d'un état actif.
- **Focus** (`outline: 0.1875rem solid #5E6FEA` + `box-shadow: 0 0 0 0.35rem rgba(94, 111, 234, 0.25)`) :
  au clavier et à la télécommande ; plus épais sur TV.

### Named Rules
**La règle du verre léger sur TV.** Le flou (`backdrop-filter`) coûte cher sur une box TV
modeste : sur `.nyx-tv`, préférer un fond fumé plus opaque sans flou dès qu'une mesure montre un
ralentissement.

## 5. Components

### Buttons (`NyxButton`)
Nets et lumineux, avec un léger dégradé qui leur donne de la matière.
- **Shape :** coins arrondis (0.5rem) ; secondaire en pilule (2rem).
- **Primary :** dégradé diagonal de la couleur pleine vers 75 % d'opacité, texte blanc, ombre
  teintée. Trois couleurs : bleu (action principale), bleu lumière (accent), rouge (destructif).
- **Secondary :** fond nuit fumé et flouté, contour en dégradé bleu → rouge (de gauche à droite).
- **Tailles :** md 1.25rem (padding 0.625rem 2.8125rem), sm 1rem, xs 0.75rem. Police Space Grotesk 500.
- **Survol :** couleur un cran plus claire, sous `@media (hover: hover)` pour le code nouveau.
  **Focus :** liseré bleu lumière.

### Cartes d'affiche (carrousels, grilles)
- **Shape :** ratio 2:3, coins 0.75rem, largeur encadrée `clamp(9.5rem, 13vw, 15.625rem)` sur bureau.
- **Survol (bureau) :** agrandissement de 5 % vers le bas, ombre sombre. **Focus (TV) :** liseré
  épais et agrandissement, sans boutons internes sur le parcours.
- Grilles : nombre de colonnes choisi pour garder une carte entre ≈ 92 et 150 points sur téléphone.

### Navigation
- **Bureau et TV :** barre latérale flottante, pilule verticale (88 px de large), icône Nyx en
  tête ; sur TV, une seconde colonne pour les catégories. En verre fumé sur bureau ; sur TV, voile
  sombre sans flou (règle du verre léger), gardé après essai sur la télé : le flou y coûtait trop en
  fluidité.
- **Téléphone :** île flottante transparente en gélule, centrée en bas ; le contenu défile dessous.

### Fenêtres et menus
- Verre fumé plus opaque (`--surface-modal`, `--glass-bg-player` dans le lecteur), coins 1 à
  1.5rem ; sur téléphone, les fenêtres montent du bas.

### Champs de saisie
- Fond verre très léger, bordure blanche discrète ; au focus, bordure bleue (`--focus-border`).

## 6. Do's and Don'ts

### Do:
- **Do** utiliser les jetons de `src/App.css` (`--nyx-*`, `--surface-*`, `--text-*`, `--space-*`,
  `--radius-*`) plutôt que des valeurs en dur.
- **Do** laisser les affiches et les images occuper l'espace ; l'interface se met en retrait.
- **Do** rendre tout visible au focus : ce qui n'apparaît qu'au survol n'existe pas sur TV ni au doigt.
- **Do** adapter la mise en page à chaque appareil via `.nyx-mobile` / `.nyx-tv`, pas réduire le bureau.
- **Do** alléger sur TV (flou, animations permanentes) avant d'ajouter un effet.

### Don't:
- **Don't** ressembler à un lecteur IPTV classique (TiviMate, IPTV Smarters) : pas de longues listes
  brutes ni de grilles surchargées.
- **Don't** tomber dans le style gaming / néon : pas de lueurs saturées, pas de couleurs vives en masse.
- **Don't** donner aux paramètres ou aux formulaires un aspect d'outil administratif.
- **Don't** utiliser le rouge vif #E50914 ni copier la marque Netflix.
- **Don't** utiliser `!important` ni des tailles fixes pour la mise en page (voir `docs/CSS_RULES.md`).
