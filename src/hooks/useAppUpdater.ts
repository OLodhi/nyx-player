import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Update } from '@tauri-apps/plugin-updater';
import { checkForAppUpdate } from '../services/appUpdateCheck';
import { devLog } from '../utils/devLog';
import { isAndroid, isMobile } from '../utils/platform';
import { createLogger } from '../utils/logger';
import {
  AndroidUpdateError,
  checkAndroidUpdate,
  downloadAndroidUpdate,
  openAndroidInstaller,
  requestInstallPermission,
  type AndroidUpdate,
  type AndroidUpdateErrorCode,
} from '../services/androidUpdate';

const log = createLogger('Updater');

// =============================================================================
// TYPES
// =============================================================================

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

export interface AppUpdaterState {
  /** Current status of the update process */
  status: UpdateStatus;
  /** Version string of the available update (e.g. "0.6.0") */
  version: string | null;
  /** Release notes from latest.json */
  notes: string | null;
  /** Download progress (0–100) */
  progress: number;
  /** Error message if status is 'error' */
  error: string | null;
  /** Android : cause de l'échec, traduite par l'interface (null ailleurs) */
  androidError: AndroidUpdateErrorCode | null;
  /** Android : adresse de l'APK proposé, à donner en secours si l'installation échoue */
  apkUrl: string | null;
  /** Android : l'écran « Installer des applis inconnues » a été ouvert, relancer l'installation au retour */
  needsInstallPermission: boolean;
  /** Check for available updates (fire-and-forget safe). Pass `{ silent: true }` to suppress error banner. */
  checkForUpdate: (options?: { silent?: boolean }) => Promise<void>;
  /** Start downloading and installing the update (Android : relancé en 'ready', rouvre l'installateur) */
  installUpdate: () => Promise<void>;
  /** Dismiss the update notification */
  dismiss: () => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook that manages the entire Tauri auto-update lifecycle.
 *
 * Usage:
 * ```tsx
 * const { status, version, progress, checkForUpdate, installUpdate, dismiss } = useAppUpdater();
 * ```
 *
 * - Auto-checks 5s after mount (silent mode — errors are suppressed).
 * - Manual check available via `checkForUpdate()` (errors shown to user).
 * - If an update is available, `status` becomes 'available' and `version` is set.
 * - Call `installUpdate()` to download + install. Progress is reported via `progress`.
 * - After download, `status` becomes 'ready'. Call `relaunch()` from the UI.
 */
export function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [androidError, setAndroidError] = useState<AndroidUpdateErrorCode | null>(null);
  const [apkUrl, setApkUrl] = useState<string | null>(null);
  const [needsInstallPermission, setNeedsInstallPermission] = useState(false);

  // Store the Update object ref to use across check → install
  const updateRef = useRef<Update | null>(null);
  // Android : APK proposé, puis téléchargé et vérifié (l'installateur peut être rouvert sans le retélécharger)
  const androidUpdateRef = useRef<AndroidUpdate | null>(null);
  const androidDownloadedRef = useRef(false);
  // Téléchargement ou ouverture de l'installateur en cours : un second appui ne relance rien
  const androidBusyRef = useRef(false);
  // Dernier essai d'installation en échec
  const androidFailedRef = useRef(false);

  // Prevent concurrent checks (but allow sequential re-checks)
  const isCheckingRef = useRef(false);

  // ---------------------------
  // CHECK FOR UPDATE
  // ---------------------------
  const checkForUpdate = useCallback(async (options?: { silent?: boolean }) => {
    // Android (téléphone et TV) : APK lu dans android.json ; iOS : rien
    const android = isAndroid();
    if (isMobile() && !android) return;
    // Prevent concurrent checks only, not re-checks
    if (isCheckingRef.current) return;
    // Téléchargement en cours, ou APK prêt sans échec : une nouvelle vérification ne doit pas l'effacer.
    // Après un échec, elle repart de zéro (sinon « Réessayer » rejouerait le même échec sans issue).
    if (android && (androidBusyRef.current || (androidDownloadedRef.current && !androidFailedRef.current))) return;
    isCheckingRef.current = true;

    try {
      setStatus('checking');
      setError(null);
      setAndroidError(null);

      if (android) {
        // Nouvelle vérification : la proposition précédente est oubliée AVANT la lecture du manifeste,
        // pour qu'un échec réseau n'offre pas de « Réessayer » sur une version peut-être dépassée
        androidUpdateRef.current = null;
        androidDownloadedRef.current = false;
        androidFailedRef.current = false;
        setApkUrl(null);
        setNeedsInstallPermission(false);
        const apk = await checkAndroidUpdate();
        if (apk) {
          androidUpdateRef.current = apk;
          setVersion(apk.version);
          setApkUrl(apk.url);
          setNotes(null);
          setStatus('available');
          devLog('updater', `✅ Android update available: v${apk.version}`);
        } else {
          setStatus('idle');
          devLog('updater', 'App is up to date');
        }
        return;
      }

      const update = await checkForAppUpdate();

      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setNotes(update.body ?? null);
        setStatus('available');
        devLog('updater', `✅ Update available: v${update.version}`);
      } else {
        setStatus('idle');
        devLog('updater', 'App is up to date');
      }
    } catch (err) {
      log.error('Check failed:', err);
      if (options?.silent) {
        // Silent mode: don't show error banner, just go back to idle
        setStatus('idle');
        devLog('updater', 'Silent check failed, ignoring');
      } else {
        if (err instanceof AndroidUpdateError) setAndroidError(err.code);
        // Ordinateur : une vérification en échec ne laisse pas une version déjà proposée, sinon le
        // bandeau parlerait d'un téléchargement raté et « Réessayer » viserait une version peut-être dépassée
        if (!isAndroid()) {
          const stale = updateRef.current;
          updateRef.current = null;
          if (stale && typeof stale.close === 'function') void stale.close().catch(() => {});
          setVersion(null);
        }
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  // ---------------------------
  // ANDROID : TÉLÉCHARGER, VÉRIFIER, OUVRIR L'INSTALLATEUR
  // ---------------------------
  const installAndroidUpdate = useCallback(async () => {
    const apk = androidUpdateRef.current;
    if (!apk || androidBusyRef.current) return;
    androidBusyRef.current = true;
    androidFailedRef.current = false;
    try {
      setError(null);
      setAndroidError(null);
      if (!androidDownloadedRef.current) {
        // Autorisation d'abord : le réglage peut redémarrer l'app, l'APK téléchargé serait perdu
        if (!(await requestInstallPermission())) {
          setNeedsInstallPermission(true);
          return;
        }
        setNeedsInstallPermission(false);
        setStatus('downloading');
        setProgress(0);
        await downloadAndroidUpdate(apk, setProgress);
        androidDownloadedRef.current = true;
        setProgress(100);
        devLog('updater', 'Android update downloaded and verified');
      }
      setStatus('ready');
      const step = await openAndroidInstaller();
      setNeedsInstallPermission(step === 'permission');
    } catch (err) {
      log.error('Android install failed:', err);
      const code = err instanceof AndroidUpdateError ? err.code : 'install';
      // APK refusé ou absent : le retélécharger au prochain essai
      if (code !== 'install') androidDownloadedRef.current = false;
      androidFailedRef.current = true;
      setAndroidError(code);
      setError(err instanceof Error ? err.message : String(err));
      setNeedsInstallPermission(false);
      setStatus('error');
    } finally {
      androidBusyRef.current = false;
    }
  }, []);

  // ---------------------------
  // DOWNLOAD & INSTALL
  // ---------------------------
  const installUpdate = useCallback(async () => {
    if (isAndroid()) return installAndroidUpdate();
    const update = updateRef.current;
    if (!update) return;

    try {
      setStatus('downloading');
      setProgress(0);
      setError(null);

      let lastLoggedPercent = 0;

      let contentLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          contentLength = event.data.contentLength;
          devLog('updater', `Download started: ${Math.round(contentLength / 1024)} KB`);
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const percent = contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
          setProgress(Math.min(percent, 100));
          // Log every 25%
          if (Math.floor(percent / 25) > Math.floor(lastLoggedPercent / 25)) {
            devLog('updater', `Download: ${Math.round(percent)}%`);
            lastLoggedPercent = percent;
          }
        } else if (event.event === 'Finished') {
          devLog('updater', 'Download complete');
          setProgress(100);
        }
      });

      setStatus('ready');
      devLog('updater', '✅ Ready to relaunch');
    } catch (err) {
      log.error('Install failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, [installAndroidUpdate]);

  // ---------------------------
  // DISMISS
  // ---------------------------
  const dismiss = useCallback(() => {
    // Don't dismiss if actively downloading
    if (status === 'downloading') return;
    setStatus('idle');
    setVersion(null);
    setNotes(null);
    setProgress(0);
    setError(null);
    setAndroidError(null);
    setNeedsInstallPermission(false);
    // Android : la proposition reste valable, « Vérifier » ou le prochain lancement la refont
    androidUpdateRef.current = null;
    androidDownloadedRef.current = false;
    androidFailedRef.current = false;
    setApkUrl(null);
  }, [status]);

  // DEV TOOL: Listen for simulated update events from console (développement seulement)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: Event) => {
      const version = (e as CustomEvent).detail?.version ?? '99.0.0';
      setVersion(version);
      setNotes('Simulated update for dev testing');
      setStatus('available');
    };
    window.addEventListener('__dev-simulate-update', handler);
    return () => window.removeEventListener('__dev-simulate-update', handler);
  }, []);

  // AUTO-CHECK — delayed boot check (no auth dependency)
  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdate({ silent: true });
    }, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule vérification, 5 s après le démarrage
  }, []);

  // Cleanup: close the Update handle on unmount
  useEffect(() => {
    return () => {
      updateRef.current = null;
      androidUpdateRef.current = null;
    };
  }, []);

  // Valeur stable tant que rien ne change : les composants abonnés au contexte ne se redessinent plus à chaque rendu
  return useMemo(() => ({
    status,
    version,
    notes,
    progress,
    error,
    androidError,
    apkUrl,
    needsInstallPermission,
    checkForUpdate,
    installUpdate,
    dismiss,
  }), [status, version, notes, progress, error, androidError, apkUrl, needsInstallPermission, checkForUpdate, installUpdate, dismiss]);
}
