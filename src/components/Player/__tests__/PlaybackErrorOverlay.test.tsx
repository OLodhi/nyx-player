/**
 * Tests pour PlaybackErrorOverlay.tsx : appareil trop lent.
 * La lecture continue derrière le message : « Continuer quand même » le ferme sans arrêter.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlaybackErrorOverlay from '../PlaybackErrorOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const props = { retryAttempt: 0, onRetry: vi.fn(), onClose: vi.fn() };

describe('PlaybackErrorOverlay — appareil trop lent', () => {
  it('propose « Continuer quand même » quand la lecture continue', () => {
    const onContinue = vi.fn();
    render(<PlaybackErrorOverlay {...props} onContinue={onContinue} error={{ kind: 'device_too_slow', continuable: true }} />);
    fireEvent.click(screen.getByText('error_continue_anyway'));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('error_retry_now')).toBeNull();
  });

  it('dit que le format est déjà connu sur cet appareil', () => {
    render(<PlaybackErrorOverlay {...props} onContinue={vi.fn()} error={{ kind: 'device_too_slow', continuable: true, known: true }} />);
    expect(screen.getByText('error_device_too_slow_known')).toBeTruthy();
  });

  it('sans lecture en cours, seulement « Fermer le lecteur »', () => {
    render(<PlaybackErrorOverlay {...props} onContinue={vi.fn()} error={{ kind: 'device_too_slow' }} />);
    expect(screen.queryByText('error_continue_anyway')).toBeNull();
    expect(screen.getByText('error_close_player')).toBeTruthy();
  });
});

describe('PlaybackErrorOverlay — lecteur vidéo arrêté', () => {
  it('« Lecture interrompue » : fond opaque, Réessayer et Fermer, sans relance automatique', () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <PlaybackErrorOverlay retryAttempt={0} onRetry={onRetry} onClose={onClose} error={{ kind: 'engine_stopped', engine: 'mpv' }} />,
    );
    expect(screen.getByText('error_engine_stopped_title')).toBeTruthy();
    expect(container.querySelector('.playback-error--opaque')).not.toBeNull();
    expect(screen.queryByText('error_retry_countdown')).toBeNull();

    fireEvent.click(screen.getByText('error_retry_now'));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('error_close_player'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('les autres erreurs gardent le fond translucide', () => {
    const { container } = render(<PlaybackErrorOverlay {...props} error={{ kind: 'network' }} />);
    expect(container.querySelector('.playback-error--opaque')).toBeNull();
  });
});
