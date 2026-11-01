/**
 * Liens vers les pages légales du site nyxplayer.app.
 *
 * Les conditions d'utilisation (conditions.html / terms.html), la politique de confidentialité
 * (confidentialite.html / privacy.html) et les mentions légales (mentions-legales.html / legal.html)
 * existent en français et en anglais : on ouvre la version de la langue de l'interface.
 */

export const LEGAL_SITE_URL = 'https://nyxplayer.app';

function isFrench(language: string | undefined): boolean {
    return language?.toLowerCase().startsWith('fr') ?? false;
}

export function termsUrl(language: string | undefined): string {
    const page = isFrench(language) ? 'conditions.html' : 'terms.html';
    return `${LEGAL_SITE_URL}/${page}`;
}

export function privacyPolicyUrl(language: string | undefined): string {
    const page = isFrench(language) ? 'confidentialite.html' : 'privacy.html';
    return `${LEGAL_SITE_URL}/${page}`;
}

export function legalNoticesUrl(language: string | undefined): string {
    const page = isFrench(language) ? 'mentions-legales.html' : 'legal.html';
    return `${LEGAL_SITE_URL}/${page}`;
}
