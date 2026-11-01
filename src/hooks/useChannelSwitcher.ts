/**
 * useChannelSwitcher.ts — Logique du Channel Switcher TV (v2)
 *
 * Gère l'état open/close, marges MPV, Escape, filtrage par catégorie.
 * Doit être déclaré AVANT useSmartLock dans PlayerControls (dépendance isOpen).
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { setVideoMarginRatio } from '../services/player/mpvApi';
import type { IptvStream, IptvCategory } from '../types/iptv';
import { isCompactLayout } from '../utils/layout';
import { isTv } from '../utils/platform';
import { devLog } from '../utils/devLog';
import { useBackHandler } from './useBackHandler';
import { createLogger } from '../utils/logger';

const log = createLogger('ChannelSwitcher');

// ── Types ──────────────────────────────────────────────────────────────────

export interface LiveTvData {
  categories: IptvCategory[];
  streams: IptvStream[];
  currentChannel: IptvStream;
  currentCategoryId: string;
  favorites: Set<number>;
  pinnedCategories: Set<string>;
  togglePin: (categoryId: string) => void;
  totalChannels: number;
}

interface UseChannelSwitcherParams {
  liveTvData: LiveTvData | undefined;
}

interface UseChannelSwitcherReturn {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
  selectedCategoryId: string;
  selectCategory: (categoryId: string) => void;
  filteredChannels: IptvStream[];
  activeChannelId: number | string;
  leftMarginRatio: number;
}

// ── Constantes ─────────────────────────────────────────────────────────────

/** Zone sûre horizontale de la TV, en part de la largeur (`--tv-safe-x: 5vw` dans tv.css) */
export const TV_SAFE_X_RATIO = 0.05;

// On calcule dynamiquement le ratio selon les règles CSS du layout
const computeLeftMarginRatio = () => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const w = window.innerWidth;

  // Téléphone : panneau unique, clamp(17rem, 42vw, 22rem) (cf ChannelSwitcher.css, ChannelSwitcherCompact)
  if (isCompactLayout()) {
    return Math.max(17 * rem, Math.min(0.42 * w, 22 * rem)) / w;
  }

  // Sidebar: 18vw, min 12rem, max 16rem (cf ChannelSwitcher.css) ; sur TV, élargie de la zone sûre
  // (5vw, tv.css) où son contenu rentre pour ne pas être rogné par la télé
  const tvSafePx = isTv() ? TV_SAFE_X_RATIO * w : 0;
  let sidebarPx = 0.18 * w;
  sidebarPx = Math.max(12 * rem, Math.min(sidebarPx, 16 * rem)) + tvSafePx;

  // Grid: 22vw, min 14rem, max 22rem
  let gridPx = 0.22 * w;
  gridPx = Math.max(14 * rem, Math.min(gridPx, 22 * rem));

  return (sidebarPx + gridPx) / w;
};

const MARGINS_CLOSED = { left: 0, right: 0, top: 0, bottom: 0 };

/** Chaînes d'une catégorie (`favorites` : les favoris, vide : toutes), dans l'ordre de la liste. */
export function channelsInCategory(liveTvData: LiveTvData, categoryId: string): IptvStream[] {
  if (categoryId === 'favorites') {
    return liveTvData.streams.filter(s => liveTvData.favorites.has(Number(s.stream_id)));
  }
  if (!categoryId) return liveTvData.streams;
  return liveTvData.streams.filter(s => String(s.category_id) === categoryId);
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useChannelSwitcher({ liveTvData }: UseChannelSwitcherParams): UseChannelSwitcherReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [leftRatio, setLeftRatio] = useState(0);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const isOpenRef = useRef(false);

  // Sync ref pour le cleanup
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Active channel ID (réactif — suit le zapping)
  const activeChannelId = liveTvData?.currentChannel?.stream_id ?? '';

  // ── Open / Close / Toggle ──────────────────────────────────────────────

  const open = useCallback(() => {
    if (!liveTvData) return;
    setIsOpen(true);
    // Pré-sélectionner la catégorie de la chaîne en cours
    setSelectedCategoryId(liveTvData.currentCategoryId);
    const dynamicRatio = computeLeftMarginRatio();
    setLeftRatio(dynamicRatio);
    setVideoMarginRatio({ left: dynamicRatio, right: 0, top: 0, bottom: 0 }).catch(e =>
      log.warn('setVideoMarginRatio open failed:', e)
    );
    devLog('player', '📺 Channel Switcher opened');
  }, [liveTvData]);

  const close = useCallback(() => {
    setIsOpen(false);
    setVideoMarginRatio(MARGINS_CLOSED).catch(e =>
      log.warn('setVideoMarginRatio close failed:', e)
    );
    devLog('player', '📺 Channel Switcher closed');
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, close, open]);

  // ── Sync viewport resize ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const dynamicRatio = computeLeftMarginRatio();
        setLeftRatio(dynamicRatio);
        setVideoMarginRatio({ left: dynamicRatio, right: 0, top: 0, bottom: 0 }).catch(e =>
          log.warn('setVideoMarginRatio resize failed:', e)
        );
      }, 150); // Debounce de 150ms pour préserver Tauri IPC / Rust backend des spams
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, [isOpen]);

  useBackHandler(isOpen, close);

  // ── Escape handler (capture phase) ─────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // Empêche la fermeture du player
        close();
      }
    };

    // Capture phase pour intercepter AVANT le player
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, close]);

  // ── Cleanup : reset marges si démonté alors que ouvert ─────────────────

  useEffect(() => {
    return () => {
      if (isOpenRef.current) {
        setVideoMarginRatio(MARGINS_CLOSED).catch(() => {});
      }
    };
  }, []);

  // ── Filtrage par catégorie ─────────────────────────────────────────────

  const selectCategory = useCallback((categoryId: string) => {
    setSelectedCategoryId(categoryId);
  }, []);

  const filteredChannels = useMemo(
    () => (liveTvData ? channelsInCategory(liveTvData, selectedCategoryId) : []),
    [liveTvData, selectedCategoryId],
  );

  return {
    isOpen,
    toggle,
    close,
    selectedCategoryId,
    selectCategory,
    filteredChannels,
    activeChannelId,
    leftMarginRatio: isOpen ? leftRatio : 0,
  };
}
