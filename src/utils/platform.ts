/**
 * platform.ts — Détection synchrone de la plateforme d'exécution.
 *
 * Source : tauri-plugin-os (injecté avant le chargement du bundle).
 * Fallback user-agent pour les environnements sans Tauri (tests, navigateur).
 */

import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';

let cached: string | null = null;

export function getPlatform(): string {
  if (cached !== null) return cached;
  let detected = '';
  try {
    detected = platform();
  } catch {
    detected = '';
  }
  if (!detected && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) {
    detected = 'android';
  }
  cached = detected;
  return cached;
}

export const isAndroid = (): boolean => getPlatform() === 'android';

/**
 * La couche native est le plugin nyx-android (téléphones et TV Android, iPhone et iPad) : lecteur,
 * coffre sécurisé, état du réseau. Pas isMobileDevice(), qui exclut la TV.
 */
export const usesNyxPlugin = (): boolean => {
  const p = getPlatform();
  return p === 'android' || p === 'ios';
};

/**
 * Téléphone ou tablette tactile. Une TV Android est aussi `android` pour le système :
 * elle est exclue ici, car son interface se pilote à la télécommande, pas au doigt. Vrai aussi quand
 * le banc force l'interface téléphone (setPhoneMode) ; pour l'appareil lui-même : isMobileDevice.
 */
export const isMobile = (): boolean => (isMobileDevice() || phoneForced) && !isTv();

/**
 * Vrai téléphone ou tablette (système Android ou iOS, hors TV), sans le forçage « Mode téléphone » :
 * pour ce qui dépend des capacités natives de l'appareil (fenêtre, commandes Rust), pas de l'interface.
 */
export const isMobileDevice = (): boolean => {
  const p = getPlatform();
  return (p === 'android' || p === 'ios') && !isTv();
};

// ---------------------------------------------------------------------------
// Mode téléphone forcé — banc de tests (interface téléphone sous Linux ou Windows)
// ---------------------------------------------------------------------------

let phoneForced = false;

/** Forçage de l'interface téléphone (versions de développement et d'audit seulement, main.tsx). */
export function setPhoneMode(enabled: boolean): void {
  phoneForced = enabled;
}

/**
 * Clé du forçage « Mode téléphone » : le banc de tests joue l'interface téléphone sous Linux ou
 * Windows, comme il joue l'interface TV avec TV_OVERRIDE_KEY. Jamais lue dans une version publiée.
 */
export const PHONE_OVERRIDE_KEY = 'nyx_dev_force_phone';

/** L'interface téléphone a-t-elle été forcée sur cette machine (développement ou version d'audit) ? */
export function isPhoneOverrideEnabled(): boolean {
  if (!import.meta.env.DEV && import.meta.env.VITE_AUDIT !== '1') return false;
  try {
    return localStorage.getItem(PHONE_OVERRIDE_KEY) === 'true';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Android TV — même APK que le téléphone, interface différente
// ---------------------------------------------------------------------------

let tvDetected = false;

/**
 * Vrai sur Android TV / box TV. Résolu une fois au démarrage par `detectDeviceType()`
 * (commande native `device_info`), puis synchrone pour tout le reste de l'app.
 */
export const isTv = (): boolean => tvDetected;

/** Forçage pour la preview navigateur et les tests (`?preview=androidtv`). */
export function setTvMode(enabled: boolean): void {
  tvDetected = enabled;
}

/**
 * Clé du forçage « Mode TV » : DevPanel des compilations de développement, et outil de mesure de la
 * version d'audit Windows (audit performance : parcours à la télécommande joués sur le PC). Jamais lue
 * dans une version publiée.
 */
export const TV_OVERRIDE_KEY = 'nyx_dev_force_tv';

/** L'interface TV a-t-elle été forcée sur cette machine (développement ou version d'audit) ? */
export function isTvOverrideEnabled(): boolean {
  if (!import.meta.env.DEV && import.meta.env.VITE_AUDIT !== '1') return false;
  try {
    return localStorage.getItem(TV_OVERRIDE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * À appeler une fois avant le premier rendu : demande le type d'appareil au plugin natif.
 * Hors Android, ne fait rien (Windows n'est jamais une TV).
 */
export async function detectDeviceType(): Promise<void> {
  if (!isAndroid()) return;
  try {
    const info = await invoke<{ isTv: boolean }>('plugin:nyx-android|device_info');
    tvDetected = Boolean(info?.isTv);
  } catch {
    // Plugin indisponible (preview, test) : on reste en mode tactile
  }
}
