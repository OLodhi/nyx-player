/**
 * Lecture des identifiants au démarrage : sur Android, une erreur
 * passagère du coffre n'est plus prise pour « aucun identifiant ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
let android = true;

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('../../utils/platform', () => ({ isAndroid: () => android }));
const hasContent = vi.fn();
vi.mock('../dbCore', () => ({ clearAllData: vi.fn(), hasContent: () => hasContent() }));
const checkLocalDatabase = vi.fn(async () => 'corrupt');
vi.mock('../localDatabaseHealth', () => ({ checkLocalDatabase: () => checkLocalDatabase() }));

import { StorageService, setKeyringUser, resetKeyringUser } from '../storage';

const creds = { host: 'http://h', username: 'u', password: 'p' };

describe('StorageService.getCredentialsAtStartup', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await StorageService.clearCredentials();
    invoke.mockReset();
    android = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('Android, coffre momentanément indisponible puis disponible : identifiants retrouvés', async () => {
    invoke.mockRejectedValueOnce(new Error('Keystore indisponible')).mockResolvedValueOnce({ value: JSON.stringify(creds) });
    const p = StorageService.getCredentialsAtStartup();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual(creds);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('Android, vraiment aucun identifiant (réponse null) : pas d\'attente', async () => {
    invoke.mockResolvedValueOnce({ value: null });
    expect(await StorageService.getCredentialsAtStartup()).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('Android, erreur persistante : abandon après 3 essais (comportement d\'avant)', async () => {
    invoke.mockRejectedValue(new Error('Keystore indisponible'));
    const p = StorageService.getCredentialsAtStartup();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });
});

describe('StorageService.getCredentials — identifiants gardés pour la session', () => {
  beforeEach(() => {
    invoke.mockReset();
    android = true;
  });

  it('plusieurs lectures et zaps : un seul accès au coffre', async () => {
    await StorageService.clearCredentials();
    invoke.mockReset().mockResolvedValue({ value: JSON.stringify(creds) });
    for (let i = 0; i < 5; i++) expect(await StorageService.getCredentials()).toEqual(creds);
    expect(invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:nyx-android|secure_get')).toHaveLength(1);
  });

  it('déconnexion : identifiants oubliés, le coffre est relu ensuite', async () => {
    invoke.mockResolvedValue({ value: JSON.stringify(creds) });
    await StorageService.getCredentials();
    await StorageService.clearCredentials();
    invoke.mockReset().mockResolvedValue({ value: null });
    expect(await StorageService.getCredentials()).toBeNull();
  });

  it('changement de fournisseur : les nouveaux identifiants remplacent les anciens', async () => {
    invoke.mockResolvedValue({ value: JSON.stringify(creds) });
    await StorageService.getCredentials();
    const next = { host: 'http://autre', username: 'v', password: 'q' };
    await StorageService.saveCredentials(next);
    invoke.mockReset();
    expect(await StorageService.getCredentials()).toEqual(next);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('changement de compte : les identifiants de l\'autre compte ne sont pas réutilisés', async () => {
    invoke.mockResolvedValue({ value: JSON.stringify(creds) });
    setKeyringUser('compte-a');
    await StorageService.getCredentials();
    setKeyringUser('compte-b');
    invoke.mockReset().mockResolvedValue({ value: null });
    expect(await StorageService.getCredentials()).toBeNull();
    resetKeyringUser();
  });

  it('déconnexion pendant une lecture du coffre : la valeur lue n\'est pas gardée', async () => {
    await StorageService.clearCredentials();
    let answer: (v: unknown) => void = () => {};
    invoke.mockReset().mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const reading = StorageService.getCredentials();
    await StorageService.clearCredentials();
    answer({ value: JSON.stringify(creds) });
    await reading;
    invoke.mockReset().mockResolvedValue({ value: null });
    expect(await StorageService.getCredentials()).toBeNull();
  });
});

describe('StorageService.hasData — base occupée au démarrage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hasContent.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('erreur passagère de la base puis réponse : catalogue retrouvé (plus pris pour « aucune source »)', async () => {
    hasContent.mockRejectedValueOnce(new Error('database is locked')).mockResolvedValueOnce(true);
    const p = StorageService.hasData();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(true);
    expect(hasContent).toHaveBeenCalledTimes(2);
  });

  it('base vraiment vide : pas d\'attente', async () => {
    hasContent.mockResolvedValueOnce(false);
    expect(await StorageService.hasData()).toBe(false);
    expect(hasContent).toHaveBeenCalledTimes(1);
  });

  it('erreur persistante : abandon après 3 essais', async () => {
    hasContent.mockRejectedValue(new Error('database is locked'));
    const p = StorageService.hasData();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe(false);
    expect(hasContent).toHaveBeenCalledTimes(3);
  });

  it('base illisible après 3 essais : contrôlée, pour proposer la réinitialisation', async () => {
    checkLocalDatabase.mockClear();
    hasContent.mockRejectedValue(new Error('error returned from database: (code: 26) file is not a database'));
    const p = StorageService.hasData();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toBe(false);
    expect(checkLocalDatabase).toHaveBeenCalledTimes(1);
  });

  it('base vide ou lue : aucun contrôle (il lit tout le fichier)', async () => {
    checkLocalDatabase.mockClear();
    hasContent.mockResolvedValueOnce(false);
    await StorageService.hasData();
    expect(checkLocalDatabase).not.toHaveBeenCalled();
  });
});
