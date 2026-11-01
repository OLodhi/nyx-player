/**
 * contentFilters.ts — Filtres de contenu partagés
 *
 * Source unique pour la détection de scripts "exotiques"
 * (arabe, hébreu, CJK, hindi, thaï, etc.)
 * Consommé par lightIndexHelpers.ts et potentiellement d'autres modules.
 */

/**
 * Regex détectant les scripts non-latins/non-cyrilliques.
 * Couvre : arabe, hébreu, devanagari, bengali, CJK, thaï.
 */
// eslint-disable-next-line no-misleading-character-class -- plages de blocs Unicode entiers, signes combinants compris, voulues
export const EXOTIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u4E00-\u9FFF\u3000-\u303F\u3400-\u4DBF\u0E00-\u0E7F]/;

/**
 * Vérifie si un texte contient des caractères exotiques ET que le filtre est activé.
 * @param text - Texte à tester (nom, plot, etc.)
 * @param isEnabled - true si le filtre exotique est activé dans les préférences
 * @returns true si le filtre est actif ET le texte contient des scripts exotiques
 */
export function isExoticName(text: string, isEnabled: boolean): boolean {
  return isEnabled && EXOTIC_SCRIPT_REGEX.test(text);
}

