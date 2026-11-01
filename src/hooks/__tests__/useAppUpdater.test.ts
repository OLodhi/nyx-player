/**
 * Mises à jour de l'appli Windows : le service de mise à jour de
 * Tauri est simulé, rien n'est téléchargé. Vérifie : pas de mise à jour, mise à jour disponible,
 * vérification en échec (silencieuse au démarrage, affichée à la demande), téléchargement suivi puis
 * prêt au redémarrage, téléchargement en échec, fermeture du bandeau, et rien sur iOS. Android
 * (téléphone et TV) : useAppUpdater.android.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

const { check, platform } = vi.hoisted(() => ({
  check: vi.fn(),
  platform: { mobile: false, android: false },
}));

vi.mock('../../services/appUpdateCheck', () => ({ checkForAppUpdate: check }));
vi.mock('../../utils/platform', () => ({ isMobile: () => platform.mobile, isAndroid: () => platform.android }));
vi.mock('../../utils/devLog', () => ({ devLog: vi.fn() }));

import { useAppUpdater } from '../useAppUpdater';

/** Mise à jour factice : `downloadAndInstall` rejoue les étapes données au rappel de progression */
function fakeUpdate(steps: DownloadEvent[] = [], fail?: unknown) {
  return {
    version: '0.8.0',
    body: 'Notes de version',
    downloadAndInstall: vi.fn(async (onEvent: (e: DownloadEvent) => void) => {
      for (const step of steps) onEvent(step);
      if (fail !== undefined) throw fail;
    }),
  };
}

beforeEach(() => {
  check.mockReset();
  platform.mobile = false;
  platform.android = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAppUpdater — vérification', () => {
  it('aucune mise à jour : l\'état revient au repos, sans version', async () => {
    check.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.version).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('mise à jour disponible : version et notes exposées', async () => {
    check.mockResolvedValueOnce(fakeUpdate());
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('available');
    expect(result.current.version).toBe('0.8.0');
    expect(result.current.notes).toBe('Notes de version');
  });

  it('mise à jour sans notes : notes vides plutôt qu\'« undefined »', async () => {
    check.mockResolvedValueOnce({ ...fakeUpdate(), body: undefined });
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.notes).toBeNull();
  });

  it('vérification demandée en échec : l\'erreur est montrée', async () => {
    check.mockRejectedValueOnce(new Error('réseau coupé'));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('réseau coupé');
  });

  it('vérification en échec après une mise à jour proposée : la version est oubliée', async () => {
    check.mockResolvedValueOnce(fakeUpdate());
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.version).toBe('0.8.0');
    check.mockRejectedValueOnce(new Error('réseau coupé'));
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.status).toBe('error');
    expect(result.current.version).toBeNull();
    // « Réessayer » ne vise plus l'ancienne proposition
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('error');
  });

  it('erreur qui n\'est pas un objet Error : son texte est gardé', async () => {
    check.mockRejectedValueOnce('signature invalide');
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(result.current.error).toBe('signature invalide');
  });

  it('vérification silencieuse en échec : aucun bandeau d\'erreur', async () => {
    check.mockRejectedValueOnce(new Error('réseau coupé'));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate({ silent: true }); });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('deux vérifications en même temps : une seule interrogation du serveur', async () => {
    let answer: (v: unknown) => void = () => {};
    check.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const { result } = renderHook(() => useAppUpdater());
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.checkForUpdate();
      await result.current.checkForUpdate();
    });
    expect(result.current.status).toBe('checking');
    await act(async () => { answer(null); await first; });
    expect(check).toHaveBeenCalledTimes(1);

    // Une fois la première finie, une nouvelle vérification repart bien
    check.mockResolvedValueOnce(null);
    await act(async () => { await result.current.checkForUpdate(); });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('iOS : pas de vérification (ni Tauri ni APK)', async () => {
    platform.mobile = true;
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    expect(check).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('au démarrage : vérification silencieuse au bout de 5 secondes, pas avant', async () => {
    vi.useFakeTimers();
    check.mockRejectedValue(new Error('hors ligne'));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { vi.advanceTimersByTime(4999); });
    expect(check).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('appli refermée avant 5 secondes : aucune vérification', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useAppUpdater());
    unmount();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(check).not.toHaveBeenCalled();
  });
});

describe('useAppUpdater — téléchargement et installation', () => {
  const available = async (update: ReturnType<typeof fakeUpdate>) => {
    check.mockResolvedValueOnce(update);
    const hook = renderHook(() => useAppUpdater());
    await act(async () => { await hook.result.current.checkForUpdate(); });
    return hook;
  };

  it('sans mise à jour trouvée : installer ne fait rien', async () => {
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('idle');
  });

  it('téléchargement complet : progression suivie puis « prêt à redémarrer »', async () => {
    const update = fakeUpdate([
      { event: 'Started', data: { contentLength: 1000 } },
      { event: 'Progress', data: { chunkLength: 250 } },
      { event: 'Progress', data: { chunkLength: 500 } },
      { event: 'Finished' },
    ]);
    const { result } = await available(update);
    await act(async () => { await result.current.installUpdate(); });
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(100);
    expect(result.current.error).toBeNull();
  });

  it('progression en cours : pourcentage calculé sur la taille annoncée', async () => {
    let release: () => void = () => {};
    const update = fakeUpdate();
    update.downloadAndInstall.mockImplementationOnce(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 400 } });
      onEvent({ event: 'Progress', data: { chunkLength: 100 } });
      await new Promise<void>((r) => { release = r; });
    });
    const { result } = await available(update);
    let install: Promise<void> = Promise.resolve();
    await act(async () => { install = result.current.installUpdate(); });
    expect(result.current.status).toBe('downloading');
    expect(result.current.progress).toBe(25);

    // Pendant le téléchargement, « Plus tard » est sans effet
    act(() => result.current.dismiss());
    expect(result.current.status).toBe('downloading');

    await act(async () => { release(); await install; });
    expect(result.current.status).toBe('ready');
  });

  it('taille inconnue : la barre reste à 0, sans plantage ni valeur fausse', async () => {
    let release: () => void = () => {};
    const update = fakeUpdate();
    update.downloadAndInstall.mockImplementationOnce(async (onEvent) => {
      onEvent({ event: 'Started', data: {} });
      onEvent({ event: 'Progress', data: { chunkLength: 5000 } });
      await new Promise<void>((r) => { release = r; });
    });
    const { result } = await available(update);
    let install: Promise<void> = Promise.resolve();
    await act(async () => { install = result.current.installUpdate(); });
    expect(result.current.progress).toBe(0);
    await act(async () => { release(); await install; });
    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(0);
  });

  it('plus de données que la taille annoncée : progression plafonnée à 100', async () => {
    const update = fakeUpdate([
      { event: 'Started', data: { contentLength: 100 } },
      { event: 'Progress', data: { chunkLength: 150 } },
    ]);
    const { result } = await available(update);
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.progress).toBe(100);
  });

  it('téléchargement en échec : erreur montrée, plus « en cours »', async () => {
    const update = fakeUpdate(
      [{ event: 'Started', data: { contentLength: 1000 } }, { event: 'Progress', data: { chunkLength: 300 } }],
      new Error('connexion perdue'),
    );
    const { result } = await available(update);
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('connexion perdue');
  });

  it('nouvel essai après un échec : l\'erreur est effacée et le téléchargement repart de zéro', async () => {
    const update = fakeUpdate([], new Error('connexion perdue'));
    const { result } = await available(update);
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('error');

    update.downloadAndInstall.mockImplementationOnce(async (onEvent) => {
      onEvent({ event: 'Finished' });
    });
    await act(async () => { await result.current.installUpdate(); });
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
  });
});

describe('useAppUpdater — fermeture du bandeau', () => {
  it('« Plus tard » : tout est remis à zéro', async () => {
    check.mockResolvedValueOnce(fakeUpdate());
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    act(() => result.current.dismiss());
    expect(result.current.status).toBe('idle');
    expect(result.current.version).toBeNull();
    expect(result.current.notes).toBeNull();
    expect(result.current.progress).toBe(0);
  });

  it('après une erreur : « Plus tard » efface le message', async () => {
    check.mockRejectedValueOnce(new Error('réseau coupé'));
    const { result } = renderHook(() => useAppUpdater());
    await act(async () => { await result.current.checkForUpdate(); });
    act(() => result.current.dismiss());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });
});
