/**
 * gridColumns.ts — Nombre de colonnes d'une grille de cartes calculée en JavaScript
 * (grilles virtualisées : chaînes de Live TV, « Voir tout » des films et séries).
 *
 * Une taille minimum fixe casse d'un appareil à l'autre. Exemple mesuré : avec
 * un minimum de 100 points, un téléphone de 360 points (la largeur la plus répandue sur Android)
 * n'avait que deux colonnes de chaînes, aux cartes deux fois trop grandes. On encadre donc la taille
 * d'une carte (≈ 92 à 150 points sur téléphone) au lieu de fixer seulement un minimum.
 */

/** Encadrement des cartes en mise en page compacte (téléphone, tablette en portrait). */
export const COMPACT_CARD_BOUNDS = { min: 92, max: 150 } as const;

export interface GridColumnBounds {
  /** Largeur minimale d'une carte : jamais dépassée vers le bas tant qu'il y a plus d'une colonne. */
  minCard: number;
  /** Largeur maximale souhaitée : ajoute des colonnes quand `maxColumns` laisserait des cartes trop larges. */
  maxCard?: number;
  /** Plafond de colonnes, levé seulement si les cartes dépasseraient `maxCard`. */
  maxColumns?: number;
}

/**
 * Colonnes d'une grille dont chaque carte occupe `carte + gap`.
 *
 * `trackWidth` est la largeur partagée entre les colonnes, un espace `gap` compris par carte : pour
 * une grille sans espace après la dernière carte, passer `largeur disponible + gap`.
 *
 * Règle : autant de colonnes que possible sans descendre sous `minCard`, dans la limite de
 * `maxColumns` ; si ce plafond laisse des cartes plus larges que `maxCard`, on ajoute les colonnes
 * nécessaires (toujours sans descendre sous `minCard`). Une seule colonne au moins.
 */
export function fitGridColumns(trackWidth: number, gap: number, bounds: GridColumnBounds): number {
  const { minCard, maxCard, maxColumns } = bounds;
  if (!(trackWidth > 0)) return 1;

  const mostColumns = Math.max(1, Math.floor(trackWidth / (minCard + gap)));
  let columns = maxColumns !== undefined ? Math.min(mostColumns, maxColumns) : mostColumns;

  if (maxCard !== undefined) {
    const fewestColumns = Math.ceil(trackWidth / (maxCard + gap));
    columns = Math.max(columns, Math.min(fewestColumns, mostColumns));
  }

  return Math.max(1, columns);
}

/**
 * Espace laissé à droite des cartes d'une grille de chaînes (px), entre la dernière colonne et le bord du
 * conteneur, qui rogne tout ce qui dépasse. Sur TV, le cadre de focus (carte agrandie + liseré) déborde
 * d'environ 0,75 rem : le panneau de zapping du lecteur (2 colonnes, 8 px) le rognait à droite.
 */
export function channelGridRightPadding(opts: {
  maxColumns?: number;
  phone: boolean;
  tv: boolean;
  defaultPadding: number;
}): number {
  if (opts.maxColumns && opts.maxColumns <= 2) return opts.tv ? 20 : 8;
  return opts.phone ? 0 : opts.defaultPadding;
}

/**
 * Marge gauche d'une page « Voir tout » (px). Sur TV, la zone réservée à la barre latérale dépend de la
 * taille du rem et de la marge de sécurité de l'écran : la valeur fixe de bureau (136) laissait les
 * affiches sous la barre. On prend alors la zone réellement mesurée, jamais moins que la valeur de bureau.
 */
export function categoryGridPaddingLeft(opts: {
  compact: boolean;
  tv: boolean;
  measuredSafeZone: number;
}): number {
  if (opts.compact) return 16;
  const DESKTOP = 136;
  return opts.tv ? Math.max(DESKTOP, Math.ceil(opts.measuredSafeZone)) : DESKTOP;
}

/**
 * Encadrement des affiches d'une page « Voir tout » (films ou séries). Bureau : 250 px au moins, comme les
 * carrousels. TV : sur la toile de 1280 px, ce minimum ne laissait que 3 affiches par ligne, chacune presque
 * aussi haute que l'écran ; la grille prend 5 colonnes, ce qui montre plusieurs rangées à la fois.
 */
export function categoryGridColumnBounds(opts: { compact: boolean; tv: boolean }): GridColumnBounds {
  if (opts.compact) return { minCard: COMPACT_CARD_BOUNDS.min, maxCard: COMPACT_CARD_BOUNDS.max };
  return opts.tv ? { minCard: 140, maxColumns: 5 } : { minCard: 250 };
}

/**
 * Marge droite d'une page « Voir tout » (px). Sur TV, la dernière colonne s'arrête à la zone sûre de l'écran
 * (bord que beaucoup de télés rognent) ; jamais moins que la valeur de bureau si la mesure échoue.
 */
export function categoryGridPaddingRight(opts: { compact: boolean; tv: boolean; measuredSafeX: number }): number {
  if (opts.compact) return 16;
  const DESKTOP = 48;
  return opts.tv ? Math.max(DESKTOP, Math.ceil(opts.measuredSafeX)) : DESKTOP;
}
