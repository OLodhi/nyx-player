/**
 * trackLanguage.ts — Choix de la piste audio / sous-titre par défaut selon la langue de l'app.
 *
 * Sans préférence enregistrée pour un contenu, mpv sélectionne la première piste du fichier :
 * sur les fichiers IPTV multi-langues (parfois 15 pistes), on tombait sur l'arabe ou le tchèque.
 * Les fournisseurs étiquettent les pistes de façon très variable (`fr`, `fre`, `VF`, « French »…),
 * d'où la comparaison sur le code ET le titre de la piste.
 */

export interface LanguageAwareTrack {
  lang?: string;
  title?: string;
}

/** Codes ISO et libellés courants, par langue de l'interface */
const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  fr: ['fr', 'fre', 'fra', 'fr-fr', 'french', 'francais', 'français', 'vf', 'vff', 'vfq', 'vfi', 'truefrench'],
  en: ['en', 'eng', 'en-us', 'en-gb', 'english', 'anglais', 'vo'],
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z-]/g, ' ')
    .trim();
}

/** La piste est-elle dans `language` (code à 2 lettres, ex. « fr ») ? */
export function matchesLanguage(track: LanguageAwareTrack, language: string): boolean {
  const aliases = LANGUAGE_ALIASES[language.slice(0, 2).toLowerCase()];
  if (!aliases) return false;

  const lang = track.lang ? normalize(track.lang) : '';
  if (lang && aliases.includes(lang)) return true;

  // Titre libre : « Français (VFF) », « French DD+ 5.1 »… → un mot doit correspondre
  if (!track.title) return false;
  return normalize(track.title).split(/[\s-]+/).some((word) => aliases.includes(word));
}

/** Première piste dans la langue de l'app, `undefined` si aucune */
export function pickTrackForLanguage<T extends LanguageAwareTrack>(tracks: T[], language: string): T | undefined {
  return tracks.find((track) => matchesLanguage(track, language));
}
