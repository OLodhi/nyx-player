/**
 * Régression : en lecture d'une chaîne, après un zapping depuis le menu rapide, la carte
 * de chaîne cliquée garde le focus. Espace mettait en pause puis relançait aussitôt la chaîne,
 * car la carte (clickableProps) se validait aussi sur Espace. Espace ne doit faire que pause.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { usePlayerKeyboard } from '../usePlayerKeyboard';
import { clickableProps } from '../../utils/clickable';

vi.mock('../../services/player/mpvApi', () => ({
  setProperty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/preferencesService', () => ({
  isGeekStatsEnabled: () => false,
}));

interface HarnessProps {
  togglePlayPause: () => void;
  onChannel: () => void;
  isLocked?: boolean;
}

function Harness({ togglePlayPause, onChannel, isLocked = false }: HarnessProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const volumeRef = React.useRef(50);
  usePlayerKeyboard(
    { togglePlayPause, skip: vi.fn(), toggleMute: vi.fn(), toggleFullscreen: vi.fn(), setShowGeekStats: vi.fn() },
    {
      isLocked, showAudioSubMenu: false, showSpeedMenu: false,
      containerRef, volumeRef, setVolumeState: vi.fn(), setIsMuted: vi.fn(),
    },
  );
  return (
    <div ref={containerRef}>
      <div data-testid="channel" onClick={onChannel} {...clickableProps(onChannel)}>{'TF1'}</div>
      <input data-testid="search" />
    </div>
  );
}

describe('usePlayerKeyboard — Espace', () => {
  afterEach(cleanup);

  it('met en pause sans revalider la chaîne focalisée après un zapping', () => {
    const togglePlayPause = vi.fn();
    const onChannel = vi.fn();
    const { getByTestId } = render(<Harness togglePlayPause={togglePlayPause} onChannel={onChannel} />);
    const card = getByTestId('channel');

    fireEvent.click(card); // zapping depuis le menu rapide
    card.focus();
    onChannel.mockClear();

    const notPrevented = fireEvent.keyDown(card, { key: ' ' });

    expect(togglePlayPause).toHaveBeenCalledTimes(1);
    expect(onChannel).not.toHaveBeenCalled();
    expect(notPrevented).toBe(false);
  });

  it('Entrée valide toujours la carte focalisée', () => {
    const togglePlayPause = vi.fn();
    const onChannel = vi.fn();
    const { getByTestId } = render(<Harness togglePlayPause={togglePlayPause} onChannel={onChannel} />);
    const card = getByTestId('channel');
    card.focus();

    fireEvent.keyDown(card, { key: 'Enter' });

    expect(onChannel).toHaveBeenCalledTimes(1);
    expect(togglePlayPause).not.toHaveBeenCalled();
  });

  it('Espace dans un champ de saisie reste une espace', () => {
    const togglePlayPause = vi.fn();
    const { getByTestId } = render(<Harness togglePlayPause={togglePlayPause} onChannel={vi.fn()} />);

    const notPrevented = fireEvent.keyDown(getByTestId('search'), { key: ' ' });

    expect(togglePlayPause).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('démonté : Espace ne met plus en pause', () => {
    const togglePlayPause = vi.fn();
    const { unmount } = render(<Harness togglePlayPause={togglePlayPause} onChannel={vi.fn()} />);
    unmount();

    fireEvent.keyDown(document.body, { key: ' ' });

    expect(togglePlayPause).not.toHaveBeenCalled();
  });

  it('verrouillé : Espace ne met pas en pause', () => {
    const togglePlayPause = vi.fn();
    const { getByTestId } = render(<Harness togglePlayPause={togglePlayPause} onChannel={vi.fn()} isLocked />);

    fireEvent.keyDown(getByTestId('channel'), { key: ' ' });

    expect(togglePlayPause).not.toHaveBeenCalled();
  });
});
