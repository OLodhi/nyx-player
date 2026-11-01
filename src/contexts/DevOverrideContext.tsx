/**
 * DevOverrideContext — Contexte React pour forcer les états visuels en dev.
 *
 * Usage :
 *   const { overrides, setLoginOverride, resetLoginOverrides } = useDevOverrides();
 *   const errorToShow = overrides.forceError ?? realError;
 *
 *   // Xtream Login page:
 *   const { overrides, setXtreamOverride } = useDevOverrides();
 *   const isLoadingOverride = overrides.xtreamPage.forceLoading ?? realIsLoading;
 *
 * Aucun effet en production : le panneau n'existe qu'en import.meta.env.DEV, et le provider publié
 * fournit une valeur fixe (valeurs par défaut, réglages sans effet) au lieu de l'état modifiable
 * (le code de l'état disparaît du bundle publié).
 */

import type { UpdateStatus } from '../hooks/useAppUpdater';
import type { NyxButtonVariant, NyxButtonSize, NyxButtonColor } from '../components/Common/NyxButton';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

// ---- Types des overrides par page ----

export interface LoginPageOverrides {
  /** Force le mode d'affichage */
  forceMode: 'login' | 'register' | 'forgot' | null;
  /** Force un message d'erreur (clé i18n ou texte brut) */
  forceError: string | null;
  /** Force un message de succès (clé i18n) */
  forceSuccess: 'registered' | 'resent' | 'reset_sent' | null;
  /** Force le loading submit */
  forceLoadingSubmit: boolean;
  /** Force le loading forgot */
  forceLoadingForgot: boolean;
  /** Force le loading resend */
  forceLoadingResend: boolean;
  /** Force la suggestion email */
  forceEmailSuggestion: string | null;
  /** Force le cooldown signup (secondes) */
  forceSignupCooldown: number | null;
  /** Force le resend cooldown */
  forceResendCooldown: boolean;
  /** Force l'état acceptTerms */
  forceAcceptTerms: boolean | null;
  /** Force un lastRegisteredEmail pour afficher le bouton resend */
  forceLastRegisteredEmail: string | null;
  /** Force un texte erreur long pour tester l'overflow */
  forceLongError: boolean;
  /** NyxButton — force la variante (primary/secondary) */
  forceButtonVariant: NyxButtonVariant | null;
  /** NyxButton — force la taille (medium/small) */
  forceButtonSize: NyxButtonSize | null;
  /** NyxButton — force la couleur (blue/blue-light/red) */
  forceButtonColor: NyxButtonColor | null;
}

export const LOGIN_OVERRIDES_DEFAULT: LoginPageOverrides = {
  forceMode: null,
  forceError: null,
  forceSuccess: null,
  forceLoadingSubmit: false,
  forceLoadingForgot: false,
  forceLoadingResend: false,
  forceEmailSuggestion: null,
  forceSignupCooldown: null,
  forceResendCooldown: false,
  forceAcceptTerms: null,
  forceLastRegisteredEmail: null,
  forceLongError: false,
  forceButtonVariant: null,
  forceButtonSize: null,
  forceButtonColor: null,
};

// ---- Xtream Login Page (credentials IPTV) ----

/** Erreurs du formulaire Xtream que le panneau de développement sait forcer (clés de l'espace « auth »). */
export const XTREAM_FORCED_ERRORS = ['error_m3u_missing_info', 'error_m3u_invalid', 'error_login_failed'] as const;
export type XtreamForcedError = (typeof XTREAM_FORCED_ERRORS)[number];

export interface XtreamLoginOverrides {
  /** Force le mode xtream/m3u */
  forceMode: 'xtream' | 'm3u' | null;
  /** Force isLoading */
  forceLoading: boolean;
  /** Force le pourcentage de progression */
  forceProgress: number | null;
  /** Force un message d'erreur */
  forceError: XtreamForcedError | null;
  /** Force le banner session-error */
  forceSessionError: string | null;
  /** Force le banner source-warning */
  forceSourceWarning: boolean;
}

export const XTREAM_OVERRIDES_DEFAULT: XtreamLoginOverrides = {
  forceMode: null,
  forceLoading: false,
  forceProgress: null,
  forceError: null,
  forceSessionError: null,
  forceSourceWarning: false,
};

// ---- Watchlist Page ----

export interface WatchlistPageOverrides {
  /** Force le loading infini */
  forceLoading: boolean;
  /** Force la watchlist vide */
  forceEmpty: boolean;
  /** Force tous les items en orphelins (indisponibles) */
  forceOrphanItems: boolean;
  /** Force N items mock pour tester le scroll / perf */
  forceManyItems: number | null;
  /** Force un message d'erreur de chargement */
  forceError: string | null;
}

export const WATCHLIST_OVERRIDES_DEFAULT: WatchlistPageOverrides = {
  forceLoading: false,
  forceEmpty: false,
  forceOrphanItems: false,
  forceManyItems: null,
  forceError: null,
};

// ---- GlobalSearch Page ----

export interface GlobalSearchPageOverrides {
  /** Force "aucun résultat" même avec des résultats réels */
  forceNoResults: boolean;
  /** Force N items mock par catégorie pour tester le scroll / perf */
  forceManyResults: number | null;
  /** Force un message d'erreur de recherche */
  forceError: string | null;
}

export const GLOBAL_SEARCH_OVERRIDES_DEFAULT: GlobalSearchPageOverrides = {
  forceNoResults: false,
  forceManyResults: null,
  forceError: null,
};

// ---- Settings Page ----

export interface SettingsPageOverrides {
  /** Force le statut IPTV (alert banner + badge sidebar) */
  forceIptvStatus: 'ok' | 'warning' | 'error' | null;
  /** Force l'état de refresh (progress bar visible) */
  forceRefreshing: boolean;
  /** Force le pourcentage de progression du refresh */
  forceRefreshProgress: number | null;
  /** Force le mode édition des credentials */
  forceEditing: boolean;
  /** Force le statut d'expiration du compte IPTV */
  forceExpiration: 'active' | 'expiring' | 'expired' | null;
  /** Force l'ouverture de la modale CategoryManager */
  forceCategoryManager: boolean;
  /** Force le taux TMDB films (0-100) */
  forceTmdbMovieRate: number | null;
  /** Force le taux TMDB séries (0-100) */
  forceTmdbSeriesRate: number | null;
  /** Force le statut de l'updater (bouton MAJ dans AboutSection) */
  forceUpdaterStatus: UpdateStatus | null;
  /** Force le message "À jour" (AboutSection) */
  forceUpToDateMsg: boolean;
  // ---- Account overrides ----
  /** Force le formulaire profil rename ouvert */
  forceProfileRename: boolean;
  /** Force le formulaire email ouvert */
  forceEmailForm: boolean;
  /** Force le formulaire password ouvert */
  forcePasswordForm: boolean;
  /** Force le formulaire delete ouvert */
  forceDeleteConfirm: boolean;
  /** Force un loading sur une section Account */
  forceAccountLoading: 'rename' | 'email' | 'password' | 'delete' | null;
  /** Force une erreur sur une section Account */
  forceAccountError: 'rename' | 'email' | 'password' | 'delete' | null;
  /** Force un succès sur une section Account */
  forceAccountSuccess: 'rename' | 'email' | 'password' | null;
  /** Force l'affichage du toast success (texte affiché) */
  forceToast: string | null;
  /** Force l'affichage du ConfirmModal changement provider */
  forceProviderChange: boolean;
}

export const SETTINGS_OVERRIDES_DEFAULT: SettingsPageOverrides = {
  forceIptvStatus: null,
  forceRefreshing: false,
  forceRefreshProgress: null,
  forceEditing: false,
  forceExpiration: null,
  forceCategoryManager: false,
  forceTmdbMovieRate: null,
  forceTmdbSeriesRate: null,
  forceUpdaterStatus: null,
  forceUpToDateMsg: false,
  forceProfileRename: false,
  forceEmailForm: false,
  forcePasswordForm: false,
  forceDeleteConfirm: false,
  forceAccountLoading: null,
  forceAccountError: null,
  forceAccountSuccess: null,
  forceToast: null,
  forceProviderChange: false,
};

// ---- LiveTv Page ----

export interface LiveTvPageOverrides {
  /** Force le loading infini (grille) */
  forceLoading: boolean;
  /** Force aucune chaîne (état vide) */
  forceEmpty: boolean;
  /** Force un message d'erreur IPTV */
  forceError: string | null;
}

export const LIVE_TV_OVERRIDES_DEFAULT: LiveTvPageOverrides = {
  forceLoading: false,
  forceEmpty: false,
  forceError: null,
};

// ---- MovieDetail Page ----

export interface MovieDetailPageOverrides {
  /** Force le loadingState (loading/ready/fallback) */
  forceLoadingState: 'loading' | 'ready' | 'fallback' | null;
  /** Force l'absence de backdrop */
  forceNoBackdrop: boolean;
  /** Force l'absence de films similaires */
  forceNoSimilar: boolean;
  /** Force l'absence de trailer */
  forceNoTrailer: boolean;
  /** Force l'existence d'une progression (bouton reset visible) */
  forceProgress: boolean;
}

export const MOVIE_DETAIL_OVERRIDES_DEFAULT: MovieDetailPageOverrides = {
  forceLoadingState: null,
  forceNoBackdrop: false,
  forceNoSimilar: false,
  forceNoTrailer: false,
  forceProgress: false,
};

// ---- SeriesDetail Page ----

// ---- Dashboard Page ----

export interface DashboardPageOverrides {
  /** Force le mode dashboard (suggestions/films/series) */
  forceDashboardMode: 'suggestions' | 'films' | 'series' | null;
  /** Force le statut IPTV (alert banner) */
  forceIptvStatus: 'ok' | 'warning' | 'error' | null;
  /** Force le hero en skeleton loading (+ cache modes switch) */
  forceHeroLoading: boolean;
  /** Force le hero vide (fallback welcome screen) */
  forceHeroEmpty: boolean;
  /** Force la transition fade du hero (rotation manuelle) */
  forceHeroFading: boolean;
  /** Force l'absence de logo TMDB (titre texte H1) */
  forceHeroNoLogo: boolean;
  /** Force la transition mode-switching (fade-out content) */
  forceModeSwitching: boolean;
  /** Force l'absence de lightIndexes (IPTV loading fallback) */
  forceNoLightIndexes: boolean;
  /** Force le mode IPTV sans catégories (message vide) */
  forceIptvNoCategories: boolean;
}

export const DASHBOARD_OVERRIDES_DEFAULT: DashboardPageOverrides = {
  forceDashboardMode: null,
  forceIptvStatus: null,
  forceHeroLoading: false,
  forceHeroEmpty: false,
  forceHeroFading: false,
  forceHeroNoLogo: false,
  forceModeSwitching: false,
  forceNoLightIndexes: false,
  forceIptvNoCategories: false,
};

export interface SeriesDetailPageOverrides {
  /** Force le loadingState (loading/ready/fallback) */
  forceLoadingState: 'loading' | 'ready' | 'fallback' | null;
  /** Force l'absence de backdrop */
  forceNoBackdrop: boolean;
  /** Force la saison courante à 0 épisodes */
  forceEmptySeason: boolean;
  /** Force l'existence d'une progression (barres + bouton reset visible) */
  forceProgress: boolean;
  /** Force l'absence de synopsis sur les épisodes (teste le fallback) */
  forceNoEpisodeSynopsis: boolean;
  /** Force le shimmer skeleton sur les cards épisodes (simule chargement TMDB saison) */
  forceSeasonLoading: boolean;
}

export const SERIES_DETAIL_OVERRIDES_DEFAULT: SeriesDetailPageOverrides = {
  forceLoadingState: null,
  forceNoBackdrop: false,
  forceEmptySeason: false,
  forceProgress: false,
  forceNoEpisodeSynopsis: false,
  forceSeasonLoading: false,
};

// ---- PlayerControls (VOD + TV) ----

export interface PlayerControlsOverrides {
  /** Force le spinner de loading */
  forceLoading: boolean;
  /** Force l'affichage du BingePopup */
  forceBingePopup: boolean;
  /** Force l'affichage du GeekStatsOverlay */
  forceGeekStats: boolean;
  /** Force le mode série (boutons épisode prev/next visibles) */
  forceSeriesMode: boolean;
  /** Force le skeleton loading dans l'EpisodeSwitcher */
  forceEpisodeSkeleton: boolean;
}

export const PLAYER_CONTROLS_OVERRIDES_DEFAULT: PlayerControlsOverrides = {
  forceLoading: false,
  forceBingePopup: false,
  forceGeekStats: false,
  forceSeriesMode: false,
  forceEpisodeSkeleton: false,
};

export interface DevOverrideState {
  loginPage: LoginPageOverrides;
  xtreamPage: XtreamLoginOverrides;
  watchlistPage: WatchlistPageOverrides;
  globalSearchPage: GlobalSearchPageOverrides;
  settingsPage: SettingsPageOverrides;
  liveTvPage: LiveTvPageOverrides;
  movieDetailPage: MovieDetailPageOverrides;
  seriesDetailPage: SeriesDetailPageOverrides;
  dashboardPage: DashboardPageOverrides;
  playerControls: PlayerControlsOverrides;
  /** Page active détectée */
  activePage: string;
}

interface DevOverrideContextValue {
  overrides: DevOverrideState;
  setLoginOverride: <K extends keyof LoginPageOverrides>(key: K, value: LoginPageOverrides[K]) => void;
  resetLoginOverrides: () => void;
  setXtreamOverride: <K extends keyof XtreamLoginOverrides>(key: K, value: XtreamLoginOverrides[K]) => void;
  resetXtreamOverrides: () => void;
  setWatchlistOverride: <K extends keyof WatchlistPageOverrides>(key: K, value: WatchlistPageOverrides[K]) => void;
  resetWatchlistOverrides: () => void;
  setGlobalSearchOverride: <K extends keyof GlobalSearchPageOverrides>(key: K, value: GlobalSearchPageOverrides[K]) => void;
  resetGlobalSearchOverrides: () => void;
  setSettingsOverride: <K extends keyof SettingsPageOverrides>(key: K, value: SettingsPageOverrides[K]) => void;
  resetSettingsOverrides: () => void;
  setLiveTvOverride: <K extends keyof LiveTvPageOverrides>(key: K, value: LiveTvPageOverrides[K]) => void;
  resetLiveTvOverrides: () => void;
  setMovieDetailOverride: <K extends keyof MovieDetailPageOverrides>(key: K, value: MovieDetailPageOverrides[K]) => void;
  resetMovieDetailOverrides: () => void;
  setSeriesDetailOverride: <K extends keyof SeriesDetailPageOverrides>(key: K, value: SeriesDetailPageOverrides[K]) => void;
  resetSeriesDetailOverrides: () => void;
  setDashboardOverride: <K extends keyof DashboardPageOverrides>(key: K, value: DashboardPageOverrides[K]) => void;
  resetDashboardOverrides: () => void;
  setPlayerControlsOverride: <K extends keyof PlayerControlsOverrides>(key: K, value: PlayerControlsOverrides[K]) => void;
  resetPlayerControlsOverrides: () => void;
  resetAll: () => void;
  setActivePage: (page: string) => void;
  isDevMode: boolean;
}

const DevOverrideContext = createContext<DevOverrideContextValue | null>(null);

const INITIAL_STATE: DevOverrideState = {
  loginPage: { ...LOGIN_OVERRIDES_DEFAULT },
  xtreamPage: { ...XTREAM_OVERRIDES_DEFAULT },
  watchlistPage: { ...WATCHLIST_OVERRIDES_DEFAULT },
  globalSearchPage: { ...GLOBAL_SEARCH_OVERRIDES_DEFAULT },
  settingsPage: { ...SETTINGS_OVERRIDES_DEFAULT },
  liveTvPage: { ...LIVE_TV_OVERRIDES_DEFAULT },
  movieDetailPage: { ...MOVIE_DETAIL_OVERRIDES_DEFAULT },
  seriesDetailPage: { ...SERIES_DETAIL_OVERRIDES_DEFAULT },
  dashboardPage: { ...DASHBOARD_OVERRIDES_DEFAULT },
  playerControls: { ...PLAYER_CONTROLS_OVERRIDES_DEFAULT },
  activePage: 'unknown',
};

/** Provider modifiable, piloté par le DevPanel (développement seulement). */
const DevStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<DevOverrideState>({ ...INITIAL_STATE });
  const isDevMode = import.meta.env.DEV;

  const setLoginOverride = useCallback(<K extends keyof LoginPageOverrides>(
    key: K,
    value: LoginPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      loginPage: { ...prev.loginPage, [key]: value },
    }));
  }, []);

  const resetLoginOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      loginPage: { ...LOGIN_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setXtreamOverride = useCallback(<K extends keyof XtreamLoginOverrides>(
    key: K,
    value: XtreamLoginOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      xtreamPage: { ...prev.xtreamPage, [key]: value },
    }));
  }, []);

  const resetXtreamOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      xtreamPage: { ...XTREAM_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setWatchlistOverride = useCallback(<K extends keyof WatchlistPageOverrides>(
    key: K,
    value: WatchlistPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      watchlistPage: { ...prev.watchlistPage, [key]: value },
    }));
  }, []);

  const resetWatchlistOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      watchlistPage: { ...WATCHLIST_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setGlobalSearchOverride = useCallback(<K extends keyof GlobalSearchPageOverrides>(
    key: K,
    value: GlobalSearchPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      globalSearchPage: { ...prev.globalSearchPage, [key]: value },
    }));
  }, []);

  const resetGlobalSearchOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      globalSearchPage: { ...GLOBAL_SEARCH_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setSettingsOverride = useCallback(<K extends keyof SettingsPageOverrides>(
    key: K,
    value: SettingsPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      settingsPage: { ...prev.settingsPage, [key]: value },
    }));
  }, []);

  const resetSettingsOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      settingsPage: { ...SETTINGS_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setLiveTvOverride = useCallback(<K extends keyof LiveTvPageOverrides>(
    key: K,
    value: LiveTvPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      liveTvPage: { ...prev.liveTvPage, [key]: value },
    }));
  }, []);

  const resetLiveTvOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      liveTvPage: { ...LIVE_TV_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setMovieDetailOverride = useCallback(<K extends keyof MovieDetailPageOverrides>(
    key: K,
    value: MovieDetailPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      movieDetailPage: { ...prev.movieDetailPage, [key]: value },
    }));
  }, []);

  const resetMovieDetailOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      movieDetailPage: { ...MOVIE_DETAIL_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setSeriesDetailOverride = useCallback(<K extends keyof SeriesDetailPageOverrides>(
    key: K,
    value: SeriesDetailPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      seriesDetailPage: { ...prev.seriesDetailPage, [key]: value },
    }));
  }, []);

  const resetSeriesDetailOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      seriesDetailPage: { ...SERIES_DETAIL_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setDashboardOverride = useCallback(<K extends keyof DashboardPageOverrides>(
    key: K,
    value: DashboardPageOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      dashboardPage: { ...prev.dashboardPage, [key]: value },
    }));
  }, []);

  const resetDashboardOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      dashboardPage: { ...DASHBOARD_OVERRIDES_DEFAULT },
    }));
  }, []);

  const setPlayerControlsOverride = useCallback(<K extends keyof PlayerControlsOverrides>(
    key: K,
    value: PlayerControlsOverrides[K],
  ) => {
    setState(prev => ({
      ...prev,
      playerControls: { ...prev.playerControls, [key]: value },
    }));
  }, []);

  const resetPlayerControlsOverrides = useCallback(() => {
    setState(prev => ({
      ...prev,
      playerControls: { ...PLAYER_CONTROLS_OVERRIDES_DEFAULT },
    }));
  }, []);

  const resetAll = useCallback(() => {
    setState(prev => ({ ...INITIAL_STATE, activePage: prev.activePage }));
  }, []);

  const setActivePage = useCallback((page: string) => {
    setState(prev => prev.activePage === page ? prev : { ...prev, activePage: page });
  }, []);

  const value = useMemo<DevOverrideContextValue>(() => ({
    overrides: state,
    setLoginOverride,
    resetLoginOverrides,
    setXtreamOverride,
    resetXtreamOverrides,
    setWatchlistOverride,
    resetWatchlistOverrides,
    setGlobalSearchOverride,
    resetGlobalSearchOverrides,
    setSettingsOverride,
    resetSettingsOverrides,
    setLiveTvOverride,
    resetLiveTvOverrides,
    setMovieDetailOverride,
    resetMovieDetailOverrides,
    setSeriesDetailOverride,
    resetSeriesDetailOverrides,
    setDashboardOverride,
    resetDashboardOverrides,
    setPlayerControlsOverride,
    resetPlayerControlsOverrides,
    resetAll,
    setActivePage,
    isDevMode,
  }), [state, setLoginOverride, resetLoginOverrides, setXtreamOverride, resetXtreamOverrides, setWatchlistOverride, resetWatchlistOverrides, setGlobalSearchOverride, resetGlobalSearchOverrides, setSettingsOverride, resetSettingsOverrides, setLiveTvOverride, resetLiveTvOverrides, setMovieDetailOverride, resetMovieDetailOverrides, setSeriesDetailOverride, resetSeriesDetailOverrides, setDashboardOverride, resetDashboardOverrides, setPlayerControlsOverride, resetPlayerControlsOverrides, resetAll, setActivePage, isDevMode]);

  return (
    <DevOverrideContext.Provider value={value}>
      {children}
    </DevOverrideContext.Provider>
  );
};

const noop = () => {};

/** Valeur de la version publiée : jamais modifiée, aucun forçage possible. */
export const STATIC_DEV_OVERRIDES: DevOverrideContextValue = {
  overrides: INITIAL_STATE,
  setLoginOverride: noop,
  resetLoginOverrides: noop,
  setXtreamOverride: noop,
  resetXtreamOverrides: noop,
  setWatchlistOverride: noop,
  resetWatchlistOverrides: noop,
  setGlobalSearchOverride: noop,
  resetGlobalSearchOverrides: noop,
  setSettingsOverride: noop,
  resetSettingsOverrides: noop,
  setLiveTvOverride: noop,
  resetLiveTvOverrides: noop,
  setMovieDetailOverride: noop,
  resetMovieDetailOverrides: noop,
  setSeriesDetailOverride: noop,
  resetSeriesDetailOverrides: noop,
  setDashboardOverride: noop,
  resetDashboardOverrides: noop,
  setPlayerControlsOverride: noop,
  resetPlayerControlsOverrides: noop,
  resetAll: noop,
  setActivePage: noop,
  isDevMode: false,
};

/** Provider de la version publiée : valeur fixe, pas d'état ni de rendus provoqués par les pages. */
export const StaticDevOverrideProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <DevOverrideContext.Provider value={STATIC_DEV_OVERRIDES}>
    {children}
  </DevOverrideContext.Provider>
);

export const DevOverrideProvider: React.FC<{ children: React.ReactNode }> = import.meta.env.DEV
  ? DevStateProvider
  : StaticDevOverrideProvider;

export const useDevOverrides = (): DevOverrideContextValue => {
  const ctx = useContext(DevOverrideContext);
  if (!ctx) throw new Error('useDevOverrides must be used within DevOverrideProvider');
  return ctx;
};
