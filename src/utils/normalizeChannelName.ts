/**
 * Normalise un nom de chaîne IPTV pour matcher les fichiers tv-logo.
 *
 * Convention tv-logo: lowercase, tirets, code pays en suffixe
 * Exemples:
 * - "TF1 FHD [FR]" → "tf1"
 * - "France 2 4K" → "france-2"
 * - "M6 HD" → "m6"
 * - "Canal+ Sport" → "canal-plus-sport"
 *
 * @param name - Nom brut de la chaîne Xtream
 * @returns Nom normalisé pour matching tv-logo
 */
export function normalizeChannelName(name: string): string {
  if (!name) return '';

  let normalized = name.toLowerCase();

  // 1. Supprimer les tags entre crochets: [FR], [4K], [HEVC], etc.
  normalized = normalized.replace(/\[[^\]]*\]/g, '');

  // 2. Supprimer les suffixes qualité courants
  const qualitySuffixes = [
    '4k',
    'uhd',
    'fhd',
    'hd',
    'sd',
    'hevc',
    'h265',
    'h.265',
    'h264',
    'h.264',
    'ultra',
  ];
  for (const suffix of qualitySuffixes) {
    // Supprimer uniquement si c'est un mot séparé (pas au milieu d'un mot)
    const regex = new RegExp(`\\b${suffix}\\b`, 'gi');
    normalized = normalized.replace(regex, '');
  }

  // 3. Remplacer les caractères spéciaux
  normalized = normalized
    .replace(/&/g, '-and-')
    .replace(/\+/g, '-plus-')
    .replace(/'/g, '')
    .replace(/"/g, '')
    .replace(/\./g, '-')
    .replace(/:/g, '')
    .replace(/!/g, '')
    .replace(/\?/g, '');

  // 4. Remplacer espaces et underscores par tirets
  normalized = normalized.replace(/[\s_]+/g, '-');

  // 5. Supprimer les tirets multiples et en début/fin
  normalized = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '');

  // 6. Supprimer les caractères non alphanumériques restants (sauf tirets)
  normalized = normalized.replace(/[^a-z0-9-]/g, '');

  return normalized;
}

/**
 * Mapping des codes pays vers les dossiers tv-logo.
 */
const COUNTRY_FOLDER_MAP: Record<string, string> = {
  fr: 'france',
  us: 'united-states',
  uk: 'united-kingdom',
  gb: 'united-kingdom',
  de: 'germany',
  es: 'spain',
  it: 'italy',
  pt: 'portugal',
  be: 'belgium',
  ch: 'switzerland',
  ca: 'canada',
  au: 'australia',
  nl: 'netherlands',
  at: 'austria',
  pl: 'poland',
  br: 'brazil',
  mx: 'mexico',
  ar: 'argentina',
  tr: 'turkey',
  ru: 'russia',
  in: 'india',
  jp: 'japan',
  kr: 'south-korea',
  cn: 'china',
  international: 'international',
};

/**
 * Détecte le code pays à partir du nom de la chaîne.
 *
 * Recherche les patterns:
 * - Tags explicites: [FR], [US], etc.
 * - Suffixes: -fr, -us (dans le nom normalisé)
 * - Mots-clés: "france", "french", etc.
 *
 * @returns Code pays ISO 2 lettres ou "fr" par défaut (marché cible)
 */
export function detectCountry(name: string): string {
  const nameLower = name.toLowerCase();

  // 1. Chercher les tags explicites [XX]
  const tagMatch = nameLower.match(/\[([a-z]{2})\]/);
  if (tagMatch && COUNTRY_FOLDER_MAP[tagMatch[1]]) {
    return tagMatch[1];
  }

  // 2. Patterns de mots-clés par pays
  const countryPatterns: [string, RegExp[]][] = [
    ['fr', [/\bfrance\b/, /\bfrench\b/, /\bfr\b/]],
    ['us', [/\busa\b/, /\bamerican?\b/, /\bus\b/]],
    ['uk', [/\buk\b/, /\bbritish\b/, /\bengland\b/, /\bbbc\b/, /\bitv\b/, /\bsky\b/]],
    ['de', [/\bgermany\b/, /\bgerman\b/, /\bde\b/, /\bart[e]?\b/]],
    ['es', [/\bspain\b/, /\bspanish\b/, /\bes\b/]],
    ['it', [/\bitaly\b/, /\bitalian\b/, /\bit\b/, /\brai\b/]],
    ['pt', [/\bportugal\b/, /\bportuguese\b/, /\bpt\b/]],
    ['be', [/\bbelgium\b/, /\bbelgian\b/, /\bbe\b/, /\brtbf\b/]],
  ];

  for (const [code, patterns] of countryPatterns) {
    for (const pattern of patterns) {
      if (pattern.test(nameLower)) {
        return code;
      }
    }
  }

  // 3. Défaut: France (marché cible principal)
  return 'fr';
}

/**
 * Retourne le nom du dossier tv-logo pour un code pays.
 */
export function getCountryFolder(countryCode: string): string {
  return COUNTRY_FOLDER_MAP[countryCode.toLowerCase()] || 'international';
}

/**
 * Génère le nom de fichier tv-logo complet.
 *
 * @example
 * buildTvLogoFilename("TF1 FHD [FR]") → "tf1-fr"
 * buildTvLogoFilename("BBC One") → "bbc-one-uk"
 */
export function buildTvLogoFilename(channelName: string): string {
  const normalized = normalizeChannelName(channelName);
  const country = detectCountry(channelName);

  // Si le nom se termine déjà par le code pays, ne pas le dupliquer
  if (normalized.endsWith(`-${country}`)) {
    return normalized;
  }

  return `${normalized}-${country}`;
}
