/**
 * Bandeau de mise à jour de l'appli Windows (lot C de l'audit de couverture) : ce que l'utilisateur
 * voit à chaque étape et ce que font ses boutons. Le redémarrage de l'appli est simulé.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { AppUpdaterState, UpdateStatus } from '../../../hooks/useAppUpdater';

const { relaunch, platform } = vi.hoisted(() => ({ relaunch: vi.fn(), platform: { android: false, tv: false } }));

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));
vi.mock('../../../utils/platform', () => ({ isAndroid: () => platform.android, isTv: () => platform.tv }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  }),
}));

import UpdateNotification from '../UpdateNotification';
import { dispatchBack } from '../../../hooks/useBackHandler';

const updater = (status: UpdateStatus, extra: Partial<AppUpdaterState> = {}): AppUpdaterState => ({
  status,
  version: '0.8.0',
  notes: null,
  progress: 0,
  error: null,
  androidError: null,
  apkUrl: null,
  needsInstallPermission: false,
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  dismiss: vi.fn(),
  ...extra,
});

beforeEach(() => {
  relaunch.mockReset();
  platform.android = false;
  platform.tv = false;
});

describe('UpdateNotification', () => {
  it.each<UpdateStatus>(['idle', 'checking'])('%s : rien n\'est affiché', (status) => {
    const { container } = render(<UpdateNotification updater={updater(status)} />);
    expect(container.firstChild).toBeNull();
  });

  it('mise à jour disponible : version affichée, « Télécharger » lance l\'installation, « Plus tard » ferme', () => {
    const state = updater('available');
    render(<UpdateNotification updater={state} />);
    expect(screen.getByText('update_available')).toBeInTheDocument();
    expect(screen.getByText('update_version {"version":"0.8.0"}')).toBeInTheDocument();

    fireEvent.click(screen.getByText('update_download'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('update_later'));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('téléchargement : pourcentage arrondi et barre de progression', () => {
    render(<UpdateNotification updater={updater('downloading', { progress: 42.6 })} />);
    expect(screen.getByText('update_progress {"percent":43}')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '43');
    expect(bar.style.width).toBe('42.6%');
    // Pas de bouton pendant le téléchargement : on ne peut ni l'annuler ni le fermer
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('prêt : « Redémarrer » relance l\'appli', () => {
    render(<UpdateNotification updater={updater('ready')} />);
    expect(screen.getByText('update_ready')).toBeInTheDocument();
    fireEvent.click(screen.getByText('update_restart'));
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('téléchargement coupé : message traduit (plus le texte technique du module), « Réessayer » et « Plus tard »', () => {
    const state = updater('error', { error: 'error sending request for url (https://…)' });
    render(<UpdateNotification updater={state} />);
    expect(screen.getByText('update_error')).toBeInTheDocument();
    expect(screen.getByText('update_error_download')).toBeInTheDocument();
    expect(screen.queryByText(/error sending request/)).toBeNull();
    fireEvent.click(screen.getByTestId('update-retry'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('update_later'));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('vérification impossible (aucune mise à jour connue) : message traduit, pas de « Réessayer »', () => {
    render(<UpdateNotification updater={updater('error', { version: null, error: 'Could not fetch a valid release JSON' })} />);
    expect(screen.getByText('update_error_check')).toBeInTheDocument();
    expect(screen.queryByTestId('update-retry')).toBeNull();
  });

  it('erreur sans détail : seul le titre est affiché', () => {
    render(<UpdateNotification updater={updater('error')} />);
    expect(document.querySelector('.update-notification__error-detail')).toBeNull();
  });
});

describe('UpdateNotification sur le téléphone Android', () => {
  beforeEach(() => { platform.android = true; });

  it('prêt : « Installer » rouvre l\'installateur au lieu de relancer l\'app', () => {
    const state = updater('ready');
    render(<UpdateNotification updater={state} />);
    expect(screen.getByText('update_android_ready')).toBeInTheDocument();
    fireEvent.click(screen.getByText('update_android_install'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
    expect(screen.queryByTestId('update-permission-hint')).toBeNull();
  });

  it('disponible, autorisation demandée avant le téléchargement : la marche à suivre est affichée', () => {
    render(<UpdateNotification updater={updater('available', { needsInstallPermission: true })} />);
    expect(screen.getByTestId('update-permission-hint')).toHaveTextContent('update_android_permission');
  });

  it('réglage « applis inconnues » ouvert : la marche à suivre est affichée', () => {
    render(<UpdateNotification updater={updater('ready', { needsInstallPermission: true })} />);
    expect(screen.getByTestId('update-permission-hint')).toHaveTextContent('update_android_permission');
  });

  it('APK refusé : cause traduite, « Réessayer », adresse de secours', () => {
    const state = updater('error', {
      error: 'Android update failed: signature',
      androidError: 'signature',
      apkUrl: 'https://releases.nyxplayer.app/nyx-player-arm64-v0.8.1.apk',
    });
    render(<UpdateNotification updater={state} />);
    expect(screen.getByText('update_android_error_signature')).toBeInTheDocument();
    expect(screen.queryByText('Android update failed: signature')).toBeNull();
    expect(screen.getByTestId('update-apk-url')).toHaveTextContent('nyx-player-arm64-v0.8.1.apk');
    fireEvent.click(screen.getByText('update_android_retry'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateNotification sur TV (télécommande)', () => {
  let opener: HTMLButtonElement;

  beforeEach(() => {
    platform.android = true;
    platform.tv = true;
    // Une proposition « disponible » oublie la fenêtre cachée par un test précédent (état gardé hors du composant)
    render(<UpdateNotification updater={updater('available')} />).unmount();
    opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
  });
  afterEach(() => { opener.remove(); });

  it('mise à jour disponible : fenêtre qui garde la sélection, posée sur « Mettre à jour »', () => {
    const state = updater('available');
    render(<UpdateNotification updater={state} />);
    const dialog = screen.getByTestId('update-tv-dialog');
    expect(dialog).toHaveTextContent('update_version {"version":"0.8.0"}');
    expect(dialog.querySelector('[data-nav-layer="modal"]')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('update-tv-primary'));

    fireEvent.click(screen.getByTestId('update-tv-primary'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('« Plus tard » ferme et rend la sélection à l\'élément d\'avant', () => {
    const state = updater('available');
    const { rerender } = render(<UpdateNotification updater={state} />);
    fireEvent.click(screen.getByTestId('update-later'));
    expect(state.dismiss).toHaveBeenCalledTimes(1);
    rerender(<UpdateNotification updater={updater('idle')} />);
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('cachée pendant le téléchargement : reste cachée quand l\'écran change (fenêtre remontée), revient à la proposition suivante', () => {
    const { unmount } = render(<UpdateNotification updater={updater('downloading', { progress: 10 })} />);
    act(() => { dispatchBack(); });
    unmount();
    // Choix du profil → accueil : App monte une autre fenêtre
    const second = render(<UpdateNotification updater={updater('downloading', { progress: 60 })} />);
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    second.rerender(<UpdateNotification updater={updater('error', { androidError: 'network' })} />);
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    second.rerender(<UpdateNotification updater={updater('idle')} />);
    second.rerender(<UpdateNotification updater={updater('available')} />);
    expect(screen.getByTestId('update-tv-dialog')).toBeInTheDocument();
    second.unmount();
  });

  it('Retour ferme la fenêtre comme « Plus tard »', () => {
    const state = updater('available');
    render(<UpdateNotification updater={state} />);
    let consumed = false;
    act(() => { consumed = dispatchBack(); });
    expect(consumed).toBe(true);
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('téléchargement : le bouton garde la sélection sans rien relancer ; Retour cache la fenêtre sans annuler, et elle ne revient pas d\'elle-même', () => {
    const state = updater('available');
    const { rerender } = render(<UpdateNotification updater={state} />);
    const downloading = updater('downloading', { progress: 42 });
    rerender(<UpdateNotification updater={downloading} />);
    const button = screen.getByTestId('update-tv-primary');
    expect(document.activeElement).toBe(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveTextContent('update_downloading update_progress {"percent":42}');
    fireEvent.click(button);
    expect(downloading.installUpdate).not.toHaveBeenCalled();

    let consumed = false;
    act(() => { consumed = dispatchBack(); });
    expect(consumed).toBe(true);
    expect(downloading.dismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);

    // Fin du téléchargement (installateur Android) ou échec : peut-être en pleine lecture, la fenêtre reste cachée
    rerender(<UpdateNotification updater={updater('ready')} />);
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    rerender(<UpdateNotification updater={updater('error', { androidError: 'network', apkUrl: 'https://releases.nyxplayer.app/a.apk' })} />);
    expect(screen.queryByTestId('update-tv-dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('installateur fermé sans installer (fenêtre restée ouverte) : « Installer » sélectionné le rouvre', () => {
    const { rerender } = render(<UpdateNotification updater={updater('downloading', { progress: 80 })} />);
    const ready = updater('ready');
    rerender(<UpdateNotification updater={ready} />);
    expect(document.activeElement).toBe(screen.getByTestId('update-tv-primary'));
    expect(screen.getByTestId('update-tv-primary')).toHaveTextContent('update_android_install');
    fireEvent.click(screen.getByTestId('update-tv-primary'));
    expect(ready.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('erreur : Retour ferme la fenêtre', () => {
    const state = updater('error', { androidError: 'network' });
    render(<UpdateNotification updater={state} />);
    act(() => { dispatchBack(); });
    expect(state.dismiss).toHaveBeenCalledTimes(1);
  });

  it('« Plus tard » rend la sélection au champ de connexion sans ouvrir le clavier (lecture seule)', () => {
    const field = document.createElement('input');
    field.type = 'email';
    document.body.appendChild(field);
    field.focus();
    const { rerender } = render(<UpdateNotification updater={updater('available')} />);
    rerender(<UpdateNotification updater={updater('idle')} />);
    expect(document.activeElement).toBe(field);
    expect(field.readOnly).toBe(true);
    field.remove();
  });

  it('erreur sans adresse d\'APK : message et sélection sur « Plus tard »', () => {
    render(<UpdateNotification updater={updater('error', { androidError: 'network' })} />);
    expect(screen.getByTestId('update-tv-dialog')).toHaveTextContent('update_android_error_network');
    expect(screen.queryByTestId('update-tv-primary')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('update-later'));
  });

  it('erreur avec adresse d\'APK : « Réessayer » sélectionné et relance l\'installation', () => {
    const state = updater('error', { androidError: 'checksum', apkUrl: 'https://releases.nyxplayer.app/a.apk' });
    render(<UpdateNotification updater={state} />);
    expect(document.activeElement).toBe(screen.getByTestId('update-tv-primary'));
    expect(screen.getByTestId('update-tv-primary')).toHaveTextContent('update_android_retry');
    fireEvent.click(screen.getByTestId('update-tv-primary'));
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });

  it.each<UpdateStatus>(['idle', 'checking'])('%s : rien n\'est affiché', (status) => {
    const { container } = render(<UpdateNotification updater={updater(status)} />);
    expect(container.firstChild).toBeNull();
  });
});
