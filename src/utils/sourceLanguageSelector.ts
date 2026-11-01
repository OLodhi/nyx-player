/**
 * sourceLanguageSelector — Sélection automatique de source par langue
 *
 * Analyse les noms de sources IPTV pour trouver celle qui correspond
 * à la langue de l'app. Fonction pure, sans dépendance React.
 *
 * Priorité : langue app exacte → MULTI → fallback index 0
 */

/** Tokens associés à chaque langue */
const LANG_TOKENS: Record<string, RegExp[]> = {
  fr: [/\bFR\b/, /\bVF\b/, /\bFRENCH\b/],
  en: [/\bEN\b/, /\bVO\b/, /\bENGLISH\b/, /\bENG\b/],
};

/** Token universel multi-langue */
const MULTI_TOKEN = /\bMULTI\b/;

/**
 * Sélectionne l'index de la meilleure source en fonction de la langue.
 *
 * @param names - Noms des sources (ex: ["Film XYZ [FR]", "Film XYZ MULTI"])
 * @param appLang - Langue de l'app (ex: "fr", "en")
 * @returns Index de la meilleure source
 */
export function selectBestSourceIndex(names: string[], appLang: string): number {
  if (names.length <= 1) return 0;

  const lang = appLang.toLowerCase();
  const tokens = LANG_TOKENS[lang];

  // Si langue non supportée, fallback index 0
  if (!tokens) return 0;

  let multiIndex = -1;

  for (let i = 0; i < names.length; i++) {
    const upper = names[i].toUpperCase();

    // Cherche un match exact sur la langue
    for (const token of tokens) {
      if (token.test(upper)) return i;
    }

    // Garde le premier MULTI trouvé
    if (multiIndex === -1 && MULTI_TOKEN.test(upper)) {
      multiIndex = i;
    }
  }

  // Fallback : MULTI → index 0
  return multiIndex !== -1 ? multiIndex : 0;
}
