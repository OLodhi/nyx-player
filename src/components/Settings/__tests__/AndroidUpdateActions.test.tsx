/**
 * Paramètres › À propos sur Android : installer la mise à jour trouvée. Sur TV c'est le seul endroit
 * où elle s'installe (le bandeau ne fait que l'annoncer). Un seul bouton du début à la fin, pour que
 * la télécommande ne perde pas le focus.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AppUpdaterState, UpdateStatus } from '../../../hooks/useAppUpdater';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
  }),
}));

import AndroidUpdateActions from '../AndroidUpdateActions';

const updater = (status: UpdateStatus, extra: Partial<AppUpdaterState> = {}): AppUpdaterState => ({
  status,
  version: '0.8.1',
  notes: null,
  progress: 0,
  error: null,
  androidError: null,
  apkUrl: 'https://releases.nyxplayer.app/nyx-player-armv7-v0.8.1.apk',
  needsInstallPermission: false,
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
  dismiss: vi.fn(),
  ...extra,
});

const button = () => screen.getByTestId('settings-update-install');

describe('AndroidUpdateActions', () => {
  it.each<UpdateStatus>(['idle', 'checking'])('%s : rien', (status) => {
    const { container } = render(<AndroidUpdateActions updater={updater(status)} />);
    expect(container.firstChild).toBeNull();
  });

  it('disponible : « Installer la version » lance la mise à jour', () => {
    const state = updater('available');
    render(<AndroidUpdateActions updater={state} />);
    expect(button()).toHaveTextContent('update_android_install_version {"version":"0.8.1"}');
    fireEvent.click(button());
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('autorisation demandée : marche à suivre sous le bouton', () => {
    render(<AndroidUpdateActions updater={updater('available', { needsInstallPermission: true })} />);
    expect(screen.getByTestId('settings-update-permission')).toBeInTheDocument();
  });

  it('téléchargement : le même bouton montre le pourcentage, reste focusable, un appui ne fait rien', () => {
    const state = updater('downloading', { progress: 41.6 });
    render(<AndroidUpdateActions updater={state} />);
    expect(button()).toHaveTextContent('update_progress {"percent":42}');
    expect(button()).not.toBeDisabled();
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button());
    expect(state.installUpdate).not.toHaveBeenCalled();
  });

  it('prêt : « Installer » rouvre l\'installateur', () => {
    const state = updater('ready');
    render(<AndroidUpdateActions updater={state} />);
    expect(button()).toHaveTextContent('update_android_install');
    fireEvent.click(button());
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('échec : le bouton devient « Réessayer », avec la cause et l\'adresse de secours', () => {
    const state = updater('error', { androidError: 'checksum' });
    render(<AndroidUpdateActions updater={state} />);
    expect(screen.getByTestId('settings-update-error')).toHaveTextContent('update_android_error_checksum');
    expect(button()).toHaveTextContent('update_android_retry');
    fireEvent.click(button());
    expect(state.installUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/update_android_manual/)).toHaveTextContent('nyx-player-armv7-v0.8.1.apk');
  });

  it('échec de la vérification (aucun APK connu) : cause seule, sans bouton', () => {
    render(<AndroidUpdateActions updater={updater('error', { androidError: 'network', apkUrl: null })} />);
    expect(screen.getByTestId('settings-update-error')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('erreur Windows (sans cause Android) : rien ici', () => {
    const { container } = render(<AndroidUpdateActions updater={updater('error', { apkUrl: null })} />);
    expect(container.firstChild).toBeNull();
  });
});
