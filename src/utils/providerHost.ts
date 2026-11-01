/**
 * Adresse du serveur du fournisseur. Le même fournisseur pouvait être pris
 * pour un autre parce que l'adresse saisie était comparée telle quelle : « / » final, espace ajoutée
 * par le clavier, majuscule mise d'office (« Http:// »), https au lieu de http. L'app demandait alors
 * de confirmer un changement de fournisseur qui efface les reprises et les favoris TV sur tous les
 * appareils du compte.
 *
 * L'empreinte du fournisseur (preferencesService.computeProviderHash) reste celle de l'adresse telle
 * qu'elle est notée (`meta.lastProvider`) : les empreintes déjà enregistrées dans le cloud et sur les
 * titres restent valables. Ce module sert à nettoyer une adresse saisie, à reconnaître deux écritures
 * du même serveur, et à retrouver l'écriture déjà connue du compte (providerHostSpellings).
 */

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' };

interface ParsedHost {
    protocol: string;
    hostname: string;
    port: string;
    path: string;
}

function parseHost(host: string): ParsedHost | null {
    const trimmed = host.trim();
    if (!trimmed) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const url = new URL(withScheme);
        if (!DEFAULT_PORTS[url.protocol] || !url.hostname) return null;
        return {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname.replace(/\/+$/, ''),
        };
    } catch {
        return null;
    }
}

/**
 * Adresse nettoyée : espaces retirés, schéma http par défaut, schéma et hôte en minuscules, port par
 * défaut et « / » final retirés. Le chemin éventuel (`/iptv`) est gardé tel quel. Une adresse
 * illisible est seulement débarrassée de ses espaces et de ses « / » finaux.
 */
export function normalizeProviderHost(host: string): string {
    const parsed = parseHost(host);
    if (!parsed) return host.trim().replace(/\/+$/, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${parsed.hostname}${port}${parsed.path}`;
}

/** Serveur désigné par une adresse, sans son schéma : http et https du même hôte sont le même fournisseur */
function serverKey(host: string): string {
    const parsed = parseHost(host);
    if (!parsed) return host.trim().replace(/\/+$/, '').toLowerCase();
    // URL retire déjà le port par défaut du schéma lu ; un autre port reste écrit (http://x:443 ≠ http://x)
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.hostname}${port}${parsed.path}`;
}

/** Vrai si les deux adresses désignent le même serveur (écriture, schéma et « / » final ignorés) */
export function sameProviderHost(a: string, b: string): boolean {
    return serverKey(a) === serverKey(b);
}

/**
 * Écritures plausibles du même serveur, dont l'empreinte a pu être enregistrée avant le nettoyage
 * des adresses (versions jusqu'à 0.8.0) : l'adresse telle que saisie, nettoyée, avec ou sans « / »
 * final, en http ou https, avec la majuscule d'un clavier de téléphone, avec ou sans le port par
 * défaut. La première est l'adresse nettoyée.
 */
export function providerHostSpellings(host: string): string[] {
    const spellings = new Set<string>([normalizeProviderHost(host)]);
    const parsed = parseHost(host);
    if (parsed) {
        const typed = host.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/:?#]/)[0];
        // Hôte tel que saisi, en minuscules, avec la majuscule d'un clavier, ou tout en majuscules :
        // l'adresse saisie arrive déjà nettoyée, l'écriture d'avant n'est connue que par son empreinte
        const capitalized = parsed.hostname.charAt(0).toUpperCase() + parsed.hostname.slice(1);
        const hostnames = new Set([parsed.hostname, typed, capitalized, parsed.hostname.toUpperCase()].filter(Boolean));
        for (const scheme of ['http', 'https']) {
            const ports = parsed.port ? [`:${parsed.port}`] : ['', `:${DEFAULT_PORTS[`${scheme}:`]}`];
            for (const prefix of [scheme, scheme[0].toUpperCase() + scheme.slice(1), scheme.toUpperCase()]) {
                for (const hostname of hostnames) {
                    for (const port of ports) {
                        const base = `${prefix}://${hostname}${port}${parsed.path}`;
                        spellings.add(base);
                        spellings.add(`${base}/`);
                    }
                }
            }
        }
    }
    spellings.add(host);
    spellings.add(host.trim());
    // Jamais l'écriture d'un autre serveur (http://x:443 et https://x:443 n'en sont pas un seul)
    return [...spellings].filter((spelling) => sameProviderHost(spelling, host));
}

/**
 * Adresse telle que l'utilisateur l'a tapée, avant nettoyage, gardée en mémoire seulement. Une
 * empreinte enregistrée avant le nettoyage des adresses a pu être calculée sur une écriture que les
 * variantes ne recréent pas (majuscules au milieu du nom, espace au début, « // » final) : sur un
 * appareil neuf, seule la saisie brute la retrouve, puisque la saisie est désormais nettoyée.
 */
let typedProviderHost: string | null = null;

export function noteTypedProviderHost(raw: string): void {
    typedProviderHost = raw;
}

/** Saisie brute (telle quelle et sans espaces) si elle désigne le même serveur que `host`, sinon rien */
export function typedProviderHostSpellings(host: string): string[] {
    if (!typedProviderHost || !sameProviderHost(typedProviderHost, host)) return [];
    return [typedProviderHost, typedProviderHost.trim()];
}
