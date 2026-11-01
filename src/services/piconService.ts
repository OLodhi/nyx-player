/**
 * Service de résolution des picons (logos de chaînes TV).
 * 
 * OPTIMISÉ: Utilise un index statique pour vérifier l'existence des logos
 * AVANT toute requête réseau, éliminant les erreurs 404.
 * Cache double-couche : mémoire (sync) + SQLite (persist).
 *
 * Priorité de résolution:
 * 1. Index statique → URL directe GitHub (si trouvé)
 * 2. stream_icon Xtream (fallback)
 * 3. null (placeholder)
 */

import {
  normalizeChannelName,
  detectCountry,
  getCountryFolder,
  buildTvLogoFilename,
} from '../utils/normalizeChannelName';
import { getCachedPicon, cachePicon } from './piconCache';

const TV_LOGO_BASE = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main';

/**
 * Index des picons disponibles (Set pour lookup O(1)).
 *
 * Chargé à la demande : le fichier fait ≈ 186 Ko et n'est utile qu'à l'affichage d'un
 * logo de chaîne. Il était importé en statique, donc lu et converti au lancement, avant même le
 * premier écran. Il forme maintenant un bloc séparé, chargé au premier logo demandé.
 */
let piconIndex: Set<string> | null = null;
let piconIndexLoading: Promise<void> | null = null;

/** Charge l'index (une seule fois). En cas d'échec, un appel suivant réessaie. */
export function loadPiconIndex(): Promise<void> {
  if (piconIndex) return Promise.resolve();
  if (!piconIndexLoading) {
    piconIndexLoading = import('../data/picon-index.json')
      .then((mod) => {
        piconIndex = new Set<string>(mod.default as string[]);
      })
      .catch((error: unknown) => {
        piconIndexLoading = null;
        throw error;
      });
  }
  return piconIndexLoading;
}

/** Vrai quand l'index est en mémoire (résolution synchrone possible). */
export function isPiconIndexLoaded(): boolean {
  return piconIndex !== null;
}

/**
 * Mapping manuel pour les chaînes au nom difficile à matcher automatiquement.
 * Clé = nom normalisé, Valeur = chemin relatif dans tv-logo (sans extension ni prefix countries/)
 * Externalisé dans channel-mapping.json pour maintenance facilitée.
 */
import channelMappingData from '../data/channel-mapping.json';
import { createLogger } from '../utils/logger';

const log = createLogger('Picon');
const MANUAL_CHANNEL_MAPPING: Record<string, string> = channelMappingData;


/**
 * Vérifie si un picon existe dans l'index.
 * Retourne le path complet si trouvé, sinon null.
 */
function findInIndex(piconIndex: Set<string>, channelName: string): string | null {
  const normalized = normalizeChannelName(channelName);
  const country = detectCountry(channelName);
  const folder = getCountryFolder(country);
  const filename = buildTvLogoFilename(channelName);

  // 1. Vérifier le mapping manuel d'abord
  if (MANUAL_CHANNEL_MAPPING[normalized]) {
    const manualFilename = MANUAL_CHANNEL_MAPPING[normalized].split('/').pop()!;
    if (piconIndex.has(manualFilename)) {
      return `${TV_LOGO_BASE}/countries/${MANUAL_CHANNEL_MAPPING[normalized]}.png`;
    }
  }

  // 2. Essayer le nom de fichier standard (avec code pays)
  if (piconIndex.has(filename)) {
    return `${TV_LOGO_BASE}/countries/${folder}/${filename}.png`;
  }

  // 3. Essayer le nom normalisé sans le suffixe pays
  if (normalized !== filename && piconIndex.has(normalized)) {
    return `${TV_LOGO_BASE}/countries/${folder}/${normalized}.png`;
  }

  // 4. Essayer dans international
  if (folder !== 'international') {
    if (piconIndex.has(filename)) {
      return `${TV_LOGO_BASE}/countries/international/${filename}.png`;
    }
    if (normalized !== filename && piconIndex.has(normalized)) {
      return `${TV_LOGO_BASE}/countries/international/${normalized}.png`;
    }
  }

  return null;
}

/**
 * Résout l'URL du picon pour une chaîne donnée.
 * 
 * NOUVEAU: Vérifie l'index statique AVANT toute requête réseau.
 * Si le picon n'est pas dans l'index → retourne directement Xtream icon.
 *
 * @param channelName - Nom de la chaîne (ex: "TF1 FHD [FR]")
 * @param xtreamIcon - URL de l'icône Xtream (fallback)
 * @returns URL du picon ou null si aucun trouvé
 */
export async function getPiconUrl(
  channelName: string,
  xtreamIcon?: string
): Promise<string | null> {
  if (!channelName) {
    return xtreamIcon || null;
  }

  const cacheKey = normalizeChannelName(channelName);

  // 1. Vérifier le cache mémoire (hydraté depuis SQLite au boot)
  const cached = getCachedPicon(cacheKey);
  if (cached !== undefined) {
    return cached ?? xtreamIcon ?? null;
  }

  // 2. Vérifier l'index statique (O(1) - pas de requête réseau!), chargé au besoin
  try {
    await loadPiconIndex();
  } catch (error) {
    // Index introuvable : logo du fournisseur, sans rien mémoriser (un prochain appel réessaie)
    log.warn('Index indisponible :', error);
    return xtreamIcon || null;
  }
  const indexUrl = findInIndex(piconIndex!, channelName);
  if (indexUrl) {
    cachePicon(cacheKey, indexUrl);
    return indexUrl;
  }

  // 3. Pas dans l'index → utiliser Xtream directement (pas de 404!)
  cachePicon(cacheKey, null);
  return xtreamIcon || null;
}

/**
 * Version synchrone qui retourne immédiatement depuis le cache
 * ou l'index statique.
 *
 * Tant que l'index n'est pas chargé (premier logo affiché), répond `isPending` : le composant
 * appelle alors getPiconUrl, qui attend l'index.
 */
export function getPiconUrlSync(
  channelName: string,
  xtreamIcon?: string
): { url: string | null; isPending: boolean } {
  if (!channelName) {
    return { url: xtreamIcon || null, isPending: false };
  }

  const cacheKey = normalizeChannelName(channelName);
  const cached = getCachedPicon(cacheKey);

  if (cached !== undefined) {
    return { url: cached ?? xtreamIcon ?? null, isPending: false };
  }

  // Index pas encore chargé : réponse en attente, sans rien mémoriser (getPiconUrl résoudra)
  if (!piconIndex) {
    void loadPiconIndex().catch(() => {});
    return { url: null, isPending: true };
  }

  // Avec l'index, on peut résoudre instantanément!
  const indexUrl = findInIndex(piconIndex, channelName);
  if (indexUrl) {
    cachePicon(cacheKey, indexUrl);
    return { url: indexUrl, isPending: false };
  }

  // Pas dans l'index → retourner Xtream directement
  cachePicon(cacheKey, null);
  return { url: xtreamIcon || null, isPending: false };
}

