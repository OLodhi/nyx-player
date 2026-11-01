/**
 * Ouverture d'un lien du site (CGU, confidentialité, mentions, sources des licences) dans le
 * navigateur de l'appareil.
 *
 * Sans navigateur (Android TV sans navigateur installé, par exemple), l'ouverture échoue : une
 * petite fenêtre montre alors l'adresse à ouvrir sur un téléphone ou un ordinateur (composant
 * `components/Common/LinkFallback.tsx`, monté une fois dans main.tsx). Avant, l'échec passait
 * inaperçu : rien ne se passait à l'appui.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { createLogger } from '../utils/logger';

const log = createLogger('ExternalLink');

export const LINK_FALLBACK_EVENT = 'nyx:link-fallback';

export async function openExternalLink(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch (e) {
    // Adresses publiques du site ou des sources : rien de personnel à masquer
    log.warn(`Lien non ouvert, adresse affichée : ${url}`, e);
    window.dispatchEvent(new CustomEvent<string>(LINK_FALLBACK_EVENT, { detail: url }));
  }
}
