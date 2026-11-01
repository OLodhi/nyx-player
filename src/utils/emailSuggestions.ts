/**
 * emailSuggestions — Détection de typos dans les domaines email courants
 *
 * Utilisé avant signUp() pour suggérer une correction si le domaine
 * ressemble à une typo connue (gmial.com → gmail.com, etc.)
 *
 * L'utilisateur garde le contrôle final : il peut accepter ou ignorer la suggestion.
 */

const DOMAIN_TYPOS: Record<string, string> = {
  // Gmail
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gmaol.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  // Hotmail
  'hotmal.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmil.com': 'hotmail.com',
  // Outlook
  'outlok.com': 'outlook.com',
  'outllook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'outlool.com': 'outlook.com',
  'outook.com': 'outlook.com',
  // Yahoo
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'yaoo.com': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  // iCloud
  'iclould.com': 'icloud.com',
  'icoud.com': 'icloud.com',
  'icloud.con': 'icloud.com',
  // Proton
  'protonmal.com': 'protonmail.com',
  'protonmail.con': 'protonmail.com',
};

/**
 * Vérifie si le domaine email contient une typo connue.
 * @returns L'email corrigé, ou null si aucune suggestion.
 */
export function suggestEmailCorrection(email: string): string | null {
  const parts = email.split('@');
  if (parts.length !== 2) return null;

  const [localPart, domain] = parts;
  if (!localPart || !domain) return null;

  const normalizedDomain = domain.toLowerCase().trim();
  const suggestion = DOMAIN_TYPOS[normalizedDomain];

  if (!suggestion) return null;
  return `${localPart}@${suggestion}`;
}
