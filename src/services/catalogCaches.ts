/**
 * catalogCaches.ts — Vidage des mémoires liées au catalogue (accueil, fiches).
 *
 * Module léger à part (ni TMDB ni i18n), pour que la déconnexion Supabase puisse l'appeler.
 */

import { clearDashboardCache } from './dashboardCache';
import { clearDetailCache } from './detailFetcher';

/**
 * Vide les mémoires liées au catalogue (accueil, fiches) : connexion, reprise, déconnexion (bouton
 * ou session Supabase fermée), remise à zéro. L'accueil suivant se charge comme au premier lancement.
 */
export function resetCatalogCaches(): void {
  clearDashboardCache();
  clearDetailCache();
}
