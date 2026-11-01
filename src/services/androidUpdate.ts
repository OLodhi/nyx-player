/**
 * androidUpdate.ts — Mise à jour de l'app Android (téléphone et TV, même APK).
 *
 * Windows passe par le module de mise à jour de Tauri (latest.json, signature minisign). Android n'en
 * a pas : l'app lit `android.json` sur le site, à côté de `latest.json`, choisit l'APK de SON
 * processeur (arm64 téléphone, armv7 Chromecast et box 32 bits), le télécharge, puis ouvre
 * l'installateur Android. Le plugin natif (AppUpdater.kt) vérifie l'empreinte SHA-256, le nom
 * interne, la clé de signature et le numéro de version avant d'ouvrir l'installateur ; Android
 * refuse de toute façon une mise à jour signée avec une autre clé.
 *
 * Les décisions (manifeste valable, version plus récente, app concernée) sont ici, en fonctions
 * pures testées ; le plugin ne fait que lire le système, le réseau et les fichiers.
 */

import { invoke, addPluginListener, type PluginListener } from '@tauri-apps/api/core';

const PLUGIN = 'nyx-android';

/** Manifeste publié depuis `main` avec le site (web/updates/android.json), comme latest.json */
export const ANDROID_MANIFEST_URL = 'https://nyxplayer.app/updates/android.json';

/** Seule adresse acceptée pour un APK de la version publiée (bucket R2 des installeurs) */
const RELEASE_APK_PREFIX = 'https://releases.nyxplayer.app/';

/** La vraie app. Nyx Banc, Nyx Mesure (autre nom interne) ne se mettent jamais à jour ainsi */
export const RELEASE_PACKAGE = 'com.nyxplayer.app';

/** Un APK de Nyx pèse quelques dizaines de Mo : au-delà, le manifeste est faux */
const MAX_APK_BYTES = 300 * 1024 * 1024;

/**
 * Adresse de test du manifeste (émulateurs, versions de développement et d'audit seulement) :
 * Jamais lue dans une
 * version publiée. Deux sources : cette clé du localStorage (console de la WebView), sinon la
 * variable de compilation VITE_ANDROID_UPDATE_MANIFEST (option -ManifesteMaj du script de
 * compilation de l'APK d'audit), pour les émulateurs dont la WebView n'ouvre pas sa console.
 */
export const MANIFEST_OVERRIDE_KEY = 'nyx_dev_android_update_manifest';

export type ApkAbi = 'arm64' | 'armv7' | 'x86_64' | 'x86';

export interface AndroidAppInfo {
  packageName: string;
  versionName: string;
  /** Processeur de l'APK installé (null : inconnu, pas de mise à jour proposée) */
  abi: ApkAbi | null;
}

export interface AndroidUpdate {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

/** Échecs prévus, traduits par l'interface (common:update_android_error_<code>) */
export type AndroidUpdateErrorCode =
  | 'network'
  | 'checksum'
  | 'package'
  | 'signature'
  | 'version'
  | 'storage'
  | 'missing'
  | 'install';

/** Résultat d'une commande du plugin : jamais d'exception pour un échec prévu */
interface NativeResult {
  ok: boolean;
  code?: string;
}

const ERROR_CODES: readonly AndroidUpdateErrorCode[] = [
  'network', 'checksum', 'package', 'signature', 'version', 'storage', 'missing', 'install',
];

export class AndroidUpdateError extends Error {
  constructor(readonly code: AndroidUpdateErrorCode) {
    super(`Android update failed: ${code}`);
    this.name = 'AndroidUpdateError';
  }
}

function toErrorCode(code: string | undefined): AndroidUpdateErrorCode {
  return ERROR_CODES.find(c => c === code) ?? 'install';
}

// =============================================================================
// DÉCISIONS (fonctions pures)
// =============================================================================

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Version « X.Y.Z » en nombres (null : autre format, pré-versions comprises) */
export function parseVersion(version: string): [number, number, number] | null {
  const match = VERSION_RE.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Vrai seulement si `remote` est strictement plus récente que `current` (versions illisibles : non) */
export function isNewerVersion(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  if (!r || !c) return false;
  for (let i = 0; i < 3; i++) {
    if (r[i] !== c[i]) return r[i] > c[i];
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * APK proposé à cette app, lu dans le manifeste. Null si le manifeste est illisible, s'il n'a pas
 * d'APK pour ce processeur ou si l'entrée est incomplète. En version publiée, l'adresse doit être
 * sur releases.nyxplayer.app (`allowAnyHost` : manifeste de test seulement).
 */
export function selectUpdate(manifest: unknown, abi: ApkAbi, allowAnyHost = false): AndroidUpdate | null {
  if (!isRecord(manifest)) return null;
  const { version, apks } = manifest;
  if (typeof version !== 'string' || !parseVersion(version) || !isRecord(apks)) return null;
  const entry = apks[abi];
  if (!isRecord(entry)) return null;
  const { url, sha256, size } = entry;
  if (typeof url !== 'string' || typeof sha256 !== 'string' || typeof size !== 'number') return null;
  if (!allowAnyHost && !url.startsWith(RELEASE_APK_PREFIX)) return null;
  if (allowAnyHost && !/^https?:\/\//.test(url)) return null;
  if (!/^[0-9a-f]{64}$/i.test(sha256)) return null;
  if (!Number.isInteger(size) || size <= 0 || size > MAX_APK_BYTES) return null;
  // Sans espaces autour : le plugin compare la version de l'APK au caractère près
  return { version: version.trim(), url, sha256: sha256.toLowerCase(), size };
}

/** Mise à jour à proposer, ou null (app de test, processeur inconnu, déjà à jour) */
export function findUpdate(info: AndroidAppInfo, manifest: unknown, allowAnyHost = false): AndroidUpdate | null {
  if (info.packageName !== RELEASE_PACKAGE || !info.abi) return null;
  const update = selectUpdate(manifest, info.abi, allowAnyHost);
  if (!update || !isNewerVersion(update.version, info.versionName)) return null;
  return update;
}

// =============================================================================
// APPELS AU PLUGIN
// =============================================================================

/** Adresse de test (développement et audit seulement), sinon null */
export function manifestOverride(): string | null {
  if (!import.meta.env.DEV && import.meta.env.VITE_AUDIT !== '1') return null;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(MANIFEST_OVERRIDE_KEY);
  } catch {
    // localStorage illisible : la variable de compilation reste valable
  }
  const built: unknown = import.meta.env.VITE_ANDROID_UPDATE_MANIFEST;
  return stored || (typeof built === 'string' && built ? built : null);
}

/**
 * Cherche une mise à jour. Null : rien à proposer. Lève une erreur si le manifeste n'a pas pu être
 * lu (réseau) : la vérification au démarrage la tait, le bouton « Vérifier » l'affiche.
 */
export async function checkAndroidUpdate(): Promise<AndroidUpdate | null> {
  const info = await invoke<AndroidAppInfo>('plugin:nyx-android|update_info');
  if (info.packageName !== RELEASE_PACKAGE || !info.abi) return null;
  const override = manifestOverride();
  const result = await invoke<NativeResult & { text?: string }>('plugin:nyx-android|fetch_update_manifest', {
    url: override ?? ANDROID_MANIFEST_URL,
  });
  if (!result.ok || typeof result.text !== 'string') throw new AndroidUpdateError('network');
  let manifest: unknown;
  try {
    manifest = JSON.parse(result.text);
  } catch {
    return null;
  }
  return findUpdate(info, manifest, override !== null);
}

/** Télécharge et vérifie l'APK (progression de 0 à 100). Lève AndroidUpdateError en cas d'échec. */
export async function downloadAndroidUpdate(update: AndroidUpdate, onProgress: (percent: number) => void): Promise<void> {
  let listener: PluginListener | null = null;
  try {
    listener = await addPluginListener(PLUGIN, 'updateProgress', (payload: { downloaded?: number; total?: number }) => {
      const total = payload.total ?? update.size;
      if (total > 0 && typeof payload.downloaded === 'number') {
        onProgress(Math.min(100, (payload.downloaded / total) * 100));
      }
    });
  } catch {
    // Sans progression, le téléchargement se fait quand même
  }
  try {
    const result = await invoke<NativeResult>('plugin:nyx-android|download_update', {
      url: update.url,
      sha256: update.sha256,
      size: update.size,
      // Version annoncée : le plugin refuse un APK qui en porte une autre
      version: update.version,
    });
    if (!result.ok) throw new AndroidUpdateError(toErrorCode(result.code));
  } finally {
    void listener?.unregister();
  }
}

/**
 * Autorisation « Installer des applis inconnues », demandée avant le téléchargement : changer ce
 * réglage peut redémarrer l'app, qui efface alors l'APK téléchargé. Faux : l'écran du réglage est
 * ouvert, il faut revenir et relancer la mise à jour.
 */
export async function requestInstallPermission(): Promise<boolean> {
  const result = await invoke<{ granted?: boolean }>('plugin:nyx-android|request_install_permission');
  return result.granted !== false;
}

/**
 * Ouvre l'installateur Android sur l'APK téléchargé. 'permission' : Android demande d'abord
 * d'autoriser Nyx à installer des applis ; l'écran de réglage est ouvert, il faut revenir et
 * relancer l'installation.
 */
export async function openAndroidInstaller(): Promise<'installer' | 'permission'> {
  const result = await invoke<NativeResult & { step?: string }>('plugin:nyx-android|install_update');
  if (!result.ok) throw new AndroidUpdateError(toErrorCode(result.code));
  return result.step === 'permission' ? 'permission' : 'installer';
}
