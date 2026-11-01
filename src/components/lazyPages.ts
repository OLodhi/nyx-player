/**
 * lazyPages.ts — Pages secondaires chargées à la demande.
 *
 * Hors du fichier lu au lancement : paramètres, recherche, ma liste, page d'une catégorie, fiches
 * film et série. L'accueil, Live TV, le lecteur, la connexion et le choix du profil restent dans le
 * fichier de démarrage (premier écran et usage principal sur TV).
 */

// Styles des pages ci-dessous, importés ici en statique et dans l'ordre d'avant le découpage : ils
// restent dans le fichier CSS principal, à la même place (avant App.css et les surcouches mobile et
// TV). Chargés avec leur page, ils passeraient après tv.css et l'emporteraient sur la surcouche TV à
// spécificité égale. Le build refuse une page découpée qui apporte son propre CSS (vite.config.ts) :
// un nouveau fichier CSS d'une de ces pages s'ajoute à cette liste.
import './Navigation/SettingsSidebar.css';
import './Settings/CategoryManagerModal.css';
import './Common/ConfirmModal.css';
import './Settings/SettingsCarousels.css';
import './Settings/ThirdPartyLicensesModal.css';
import './Common/ResetOptionsModal.css';
import '../pages/SettingsPage.css';
import '../pages/WatchlistPage.css';
import '../pages/GlobalSearchPage.css';
import '../pages/CategoryDetailPage.css';
import './Detail/TrailerCard.css';
import '../pages/MovieDetailPage.css';
import '../pages/SeriesDetailPage.css';
import { lazyPage } from '../utils/lazyPage';

export const SettingsPage = lazyPage(() => import('../pages/SettingsPage'));
export const WatchlistPage = lazyPage(() => import('../pages/WatchlistPage'));
export const GlobalSearchPage = lazyPage(() => import('../pages/GlobalSearchPage'));
export const CategoryDetailPage = lazyPage(() => import('../pages/CategoryDetailPage'));
export const MovieDetailPage = lazyPage(() => import('../pages/MovieDetailPage'));
export const SeriesDetailPage = lazyPage(() => import('../pages/SeriesDetailPage'));

const SECONDARY_PAGES = [
  MovieDetailPage,
  SeriesDetailPage,
  SettingsPage,
  GlobalSearchPage,
  WatchlistPage,
  CategoryDetailPage,
];

/** Charge toutes les pages secondaires (en tâche de fond, après l'accueil). Ne rejette jamais. */
export function preloadSecondaryPages(): Promise<void> {
  return Promise.all(SECONDARY_PAGES.map((page) => page.preload().catch(() => undefined))).then(() => undefined);
}
