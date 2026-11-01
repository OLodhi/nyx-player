/**
 * Mise à jour des apps Android (téléphone et TV, même APK) : le plugin natif est simulé, rien n'est
 * téléchargé. Vérifie : version plus récente proposée, APK de son processeur, rien pour les apps de
 * test, téléchargement suivi puis installateur ouvert, réglage « applis inconnues », échecs traduits
 * et nouvel essai, Windows non concerné.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type Listener = (payload: unknown) => void;

const { invoke, addPluginListener, check, platform, listeners } = vi.hoisted(() => ({
  invoke: vi.fn(),
  addPluginListener: vi.fn(),
  check: vi.fn(),
  platform: { android: true },
  listeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke, addPluginListener }));
vi.mock('../../services/appUpdateCheck', () => ({ checkForAppUpdate: check }));
vi.mock('../../utils/platform', () => ({ isMobile: () => platform.android, isAndroid: () => platform.android }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { useAppUpdater } from '../useAppUpdater';
import { ANDROID_MANIFEST_URL, MANIFEST_OVERRIDE_KEY } from '../../services/androidUpdate';

const SHA = 'ab'.repeat(32);
const manifest = (version = '0.8.1') => JSON.stringify({
  version,
  pub_date: '2026-11-02T18:00:00Z',
  apks: {
    arm64: { url: `https://releases.nyxplayer.app/nyx-player-arm64-v${version}.apk`, sha256: SHA, size: 1000 },
    armv7: { url: `https://releases.nyxplayer.app/nyx-player-armv7-v${version}.apk`, sha256: SHA, size: 900 },
  },
});

interface Native {
  info: { packageName: string; versionName: string; abi: string | null };
  manifest: { ok: boolean; text?: string; code?: string };
  download: { ok: boolean; code?: string };
  install: { ok: boolean; step?: string; code?: string };
  permission: boolean;
}

let native: Native;

function plugin(command: string, args?: unknown): Promise<unknown> {
  switch (command) {
    case 'plugin:nyx-android|update_info': return Promise.resolve(native.info);
    case 'plugin:nyx-android|fetch_update_manifest': return Promise.resolve(native.manifest);
    case 'plugin:nyx-android|download_update': {
      const progress = listeners.get('updateProgress');
      const { size } = args as { size: number };
      progress?.({ downloaded: size / 2, total: size });
      return Promise.resolve(native.download);
    }
    case 'plugin:nyx-android|install_update': return Promise.resolve(native.install);
    case 'plugin:nyx-android|request_install_permission': return Promise.resolve({ granted: native.permission });
    default: return Promise.reject(new Error(`commande inattendue ${command}`));
  }
}

beforeEach(() => {
  invoke.mockReset().mockImplementation(plugin);
  addPluginListener.mockReset().mockImplementation(async (_plugin: string, event: string, cb: Listener) => {
    listeners.set(event, cb);
    return { unregister: vi.fn(async () => { listeners.delete(event); }) };
  });
  check.mockReset();
  listeners.clear();
  platform.android = true;
  native = {
    info: { packageName: 'com.nyxplayer.app', versionName: '0.8.0', abi: 'armv7' },
    manifest: { ok: true, text: manifest() },
    download: { ok: true },
    install: { ok: true, step: 'installer' },
    permission: true,
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const checked = async () => {
  const hook = renderHook(() => useAppUpdater());
  await act(async () => { await hook.result.current.checkForUpdate(); });
  return hook;
};

describe('useAppUpdater sur Android — vérification', () => {
  it('version plus récente : proposée, avec l\'APK du processeur de l\'app (Chromecast : armv7)', async () => {
    const { result } = await checked();
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', { url: ANDROID_MANIFEST_URL });
    expect(check).not.toHaveBeenCalled();
    expect(result.current.status).toBe('available');
    expect(result.current.version).toBe('0.8.1');
    expect(result.current.apkUrl).toBe('https://releases.nyxplayer.app/nyx-player-armv7-v0.8.1.apk');
  });

  it('version d\'audit compilée avec un manifeste de test (-ManifesteMaj) : il est lu, APK local admis', async () => {
    // Émulateur TV sans console de la WebView : l'adresse vient de la compilation, pas du localStorage
    const local = 'http://10.0.2.2:8000/android.json';
    vi.stubEnv('VITE_AUDIT', '1');
    vi.stubEnv('VITE_ANDROID_UPDATE_MANIFEST', local);
    native.manifest.text = JSON.stringify({
      version: '0.8.1',
      apks: { armv7: { url: 'http://10.0.2.2:8000/nyx-0.8.1.apk', sha256: SHA, size: 900 } },
    });
    const { result } = await checked();
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', { url: local });
    expect(result.current.status).toBe('available');
    expect(result.current.apkUrl).toBe('http://10.0.2.2:8000/nyx-0.8.1.apk');
  });

  it('version d\'audit : l\'adresse du localStorage l\'emporte ; localStorage illisible, celle de la compilation reste', async () => {
    vi.stubEnv('VITE_AUDIT', '1');
    vi.stubEnv('VITE_ANDROID_UPDATE_MANIFEST', 'http://10.0.2.2:8000/android.json');
    localStorage.setItem(MANIFEST_OVERRIDE_KEY, 'http://192.0.2.20:8000/android.json');
    try {
      await checked();
      expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', { url: 'http://192.0.2.20:8000/android.json' });
    } finally {
      localStorage.removeItem(MANIFEST_OVERRIDE_KEY);
    }
    invoke.mockClear();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqué'); });
    await checked();
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', { url: 'http://10.0.2.2:8000/android.json' });
  });

  it('version publiée : le manifeste de test est ignoré (variable de compilation ou localStorage)', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_AUDIT', '');
    vi.stubEnv('VITE_ANDROID_UPDATE_MANIFEST', 'http://10.0.2.2:8000/android.json');
    localStorage.setItem(MANIFEST_OVERRIDE_KEY, 'http://10.0.2.2:8000/android.json');
    try {
      await checked();
      expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', { url: ANDROID_MANIFEST_URL });
    } finally {
      localStorage.removeItem(MANIFEST_OVERRIDE_KEY);
    }
  });

  it('téléphone : APK arm64', async () => {
    native.info.abi = 'arm64';
    const { result } = await checked();
    expect(result.current.apkUrl).toBe('https://releases.nyxplayer.app/nyx-player-arm64-v0.8.1.apk');
  });

  it('même version ou plus ancienne : rien n\'est proposé', async () => {
    native.manifest.text = manifest('0.8.0');
    expect((await checked()).result.current.status).toBe('idle');
    native.manifest.text = manifest('0.7.6');
    expect((await checked()).result.current.status).toBe('idle');
  });

  it('manifeste du dépôt avant la sortie (0.0.0, aucun APK) : rien n\'est proposé', async () => {
    native.manifest.text = JSON.stringify({ version: '0.0.0', pub_date: '', apks: {} });
    expect((await checked()).result.current.status).toBe('idle');
  });

  it('Nyx Banc ou Nyx Mesure (autre nom interne) : le manifeste n\'est même pas lu', async () => {
    native.info.packageName = 'com.nyxplayer.app.banc';
    const { result } = await checked();
    expect(result.current.status).toBe('idle');
    expect(invoke).not.toHaveBeenCalledWith('plugin:nyx-android|fetch_update_manifest', expect.anything());
  });

  it('processeur inconnu : rien n\'est proposé', async () => {
    native.info.abi = null;
    expect((await checked()).result.current.status).toBe('idle');
  });

  it('manifeste illisible : rien n\'est proposé, sans erreur', async () => {
    native.manifest.text = '<html>404</html>';
    const { result } = await checked();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('réseau coupé : erreur montrée à la demande, silencieuse au démarrage', async () => {
    native.manifest = { ok: false, code: 'network' };
    const { result } = await checked();
    expect(result.current.status).toBe('error');
    expect(result.current.androidError).toBe('network');

    const silent = renderHook(() => useAppUpdater());
    await act(async () => { await silent.result.current.checkForUpdate({ silent: true }); });
    expect(silent.result.current.status).toBe('idle');
  });

  it('au démarrage : vérification silencieuse au bout de 5 secondes', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(5000); });
    await act(async () => { await Promise.resolve(); });
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|update_info');
    expect(result.current.status).toBe('available');
  });

  it('Windows : le module de Tauri, jamais le plugin Android', async () => {
    platform.android = false;
    check.mockResolvedValueOnce(null);
    await checked();
    expect(check).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('useAppUpdater sur Android — téléchargement et installation', () => {
  it('« Mettre à jour » : APK téléchargé avec son empreinte, progression suivie, installateur ouvert', async () => {
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|download_update', {
      url: 'https://releases.nyxplayer.app/nyx-player-armv7-v0.8.1.apk',
      sha256: SHA,
      size: 900,
      version: '0.8.1',
    });
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|install_update');
    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(100);
    expect(result.current.needsInstallPermission).toBe(false);
    expect(listeners.has('updateProgress')).toBe(false);
  });

  it('première fois : réglage « applis inconnues » ouvert, puis « Installer » rouvre l\'installateur sans retélécharger', async () => {
    native.install = { ok: true, step: 'permission' };
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.needsInstallPermission).toBe(true);

    native.install = { ok: true, step: 'installer' };
    await act(async () => { await result.current.installUpdate(); });
    const downloads = invoke.mock.calls.filter(([c]) => c === 'plugin:nyx-android|download_update');
    expect(downloads).toHaveLength(1);
    expect(result.current.needsInstallPermission).toBe(false);
  });

  it.each(['signature', 'checksum', 'package', 'version', 'storage', 'network'] as const)(
    'APK refusé (%s) : erreur traduite, adresse de secours gardée, nouvel essai retélécharge',
    async (code) => {
      native.download = { ok: false, code };
      const { result } = await checked();
      await act(async () => { await result.current.installUpdate(); });
      expect(result.current.status).toBe('error');
      expect(result.current.androidError).toBe(code);
      expect(result.current.apkUrl).toContain('releases.nyxplayer.app');
      expect(invoke).not.toHaveBeenCalledWith('plugin:nyx-android|install_update');

      native.download = { ok: true };
      await act(async () => { await result.current.installUpdate(); });
      const downloads = invoke.mock.calls.filter(([c]) => c === 'plugin:nyx-android|download_update');
      expect(downloads).toHaveLength(2);
      expect(result.current.status).toBe('ready');
      expect(result.current.androidError).toBeNull();
    },
  );

  it('installateur introuvable : erreur, l\'APK vérifié est gardé pour le nouvel essai', async () => {
    native.install = { ok: false, code: 'install' };
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('error');
    expect(result.current.androidError).toBe('install');

    native.install = { ok: true, step: 'installer' };
    await act(async () => { await result.current.installUpdate(); });
    const downloads = invoke.mock.calls.filter(([c]) => c === 'plugin:nyx-android|download_update');
    expect(downloads).toHaveLength(1);
    expect(result.current.status).toBe('ready');
  });

  it('code inconnu du plugin : rangé sous « install »', async () => {
    native.download = { ok: false, code: 'bizarre' };
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.androidError).toBe('install');
  });

  it('autorisation « applis inconnues » demandée AVANT le téléchargement (le réglage peut redémarrer l\'app)', async () => {
    native.permission = false;
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(invoke).not.toHaveBeenCalledWith('plugin:nyx-android|download_update', expect.anything());
    expect(result.current.status).toBe('available');
    expect(result.current.needsInstallPermission).toBe(true);

    native.permission = true;
    await act(async () => { await result.current.installUpdate(); });
    expect(invoke).toHaveBeenCalledWith('plugin:nyx-android|download_update', expect.anything());
    expect(result.current.status).toBe('ready');
    expect(result.current.needsInstallPermission).toBe(false);
  });

  it('double appui sur « Mettre à jour » : un seul téléchargement, pas d\'erreur', async () => {
    let finish: (v: unknown) => void = () => {};
    const { result } = await checked();
    invoke.mockImplementation((command: string, args?: unknown) => (
      command === 'plugin:nyx-android|download_update'
        ? new Promise((r) => { finish = r; })
        : plugin(command, args)
    ));
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.installUpdate();
      await Promise.resolve();
      await result.current.installUpdate();
    });
    await act(async () => { finish({ ok: true }); await first; });
    const downloads = invoke.mock.calls.filter(([c]) => c === 'plugin:nyx-android|download_update');
    expect(downloads).toHaveLength(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.androidError).toBeNull();
  });

  it('nouvelle vérification pendant une proposition : relit le manifeste et remplace la proposition', async () => {
    const { result } = await checked();
    native.manifest.text = manifest('0.8.2');
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('available');
    expect(result.current.version).toBe('0.8.2');
    expect(result.current.apkUrl).toContain('v0.8.2');
  });

  it('APK prêt : une vérification ne l\'efface pas', async () => {
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('ready');
    const fetches = invoke.mock.calls.filter(([c]) => c === 'plugin:nyx-android|fetch_update_manifest');
    expect(fetches).toHaveLength(1);
  });

  it('nouvelle vérification sans réseau : l\'ancienne proposition est oubliée, pas de « Réessayer » dessus', async () => {
    const { result } = await checked();
    native.manifest = { ok: false, code: 'network' };
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('error');
    expect(result.current.androidError).toBe('network');
    expect(result.current.apkUrl).toBeNull();
    await act(async () => { await result.current.installUpdate(); });
    expect(invoke).not.toHaveBeenCalledWith('plugin:nyx-android|download_update', expect.anything());
  });

  it('installateur en échec puis « Vérifier » : repart de zéro au lieu de rester bloqué', async () => {
    native.install = { ok: false, code: 'install' };
    const { result } = await checked();
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('error');
    native.manifest.text = manifest('0.8.2');
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('available');
    expect(result.current.version).toBe('0.8.2');
  });

  it('« Plus tard » oublie la proposition', async () => {
    const { result } = await checked();
    act(() => result.current.dismiss());
    expect(result.current.status).toBe('idle');
    expect(result.current.apkUrl).toBeNull();
    await act(async () => { await result.current.installUpdate(); });
    expect(invoke).not.toHaveBeenCalledWith('plugin:nyx-android|download_update', expect.anything());
  });
});
