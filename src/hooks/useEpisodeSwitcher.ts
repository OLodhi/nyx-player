import { useState, useCallback, useEffect } from 'react';
import { devLog } from '../utils/devLog';
import { useBackHandler } from './useBackHandler';

interface UseEpisodeSwitcherReturn {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
}

export function useEpisodeSwitcher(): UseEpisodeSwitcherReturn {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
    devLog('player', '📺 Episode Switcher opened');
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    devLog('player', '📺 Episode Switcher closed');
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, close, open]);

  useBackHandler(isOpen, close);

  // ── Escape handler (capture phase) ─────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // Empêche la fermeture du player (plein écran)
        close();
      }
    };

    // Capture phase pour intercepter AVANT le player
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, close]);

  return {
    isOpen,
    toggle,
    close,
  };
}
