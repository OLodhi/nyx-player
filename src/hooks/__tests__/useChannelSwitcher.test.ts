/**
 * Tests unitaires pour useChannelSwitcher
 *
 * Couvre :
 * - État initial (fermé)
 * - Toggle open/close avec pré-sélection catégorie
 * - Fermeture via close()
 * - Escape handler (capture phase)
 * - Filtrage par catégorie (all, specific, favorites)
 * - Active channel ID tracking
 * - Cleanup des marges MPV au démontage
 * - Resize debounce
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChannelSwitcher, TV_SAFE_X_RATIO, type LiveTvData } from '../useChannelSwitcher';
import { setTvMode } from '../../utils/platform';
import type { IptvStream, IptvCategory } from '../../types/iptv';

// ============================================================================
// MOCKS
// ============================================================================

// Mock du point d'entrée du lecteur (marges vidéo)
const mockSetVideoMarginRatio = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/player/mpvApi', () => ({
  setVideoMarginRatio: (...args: unknown[]) => mockSetVideoMarginRatio(...args),
}));

// Mock devLog
vi.mock('../../utils/devLog', () => ({
  devLog: vi.fn(),
}));

// ============================================================================
// HELPERS
// ============================================================================

function mockStream(id: number, name: string, categoryId: string): IptvStream {
  return {
    num: id,
    name,
    stream_type: 'live',
    stream_id: id,
    stream_icon: '',
    epg_channel_id: '',
    added: '',
    category_id: categoryId,
    tmdb: 0,
  };
}

function mockCategory(id: string, name: string): IptvCategory {
  return {
    category_id: id,
    category_name: name,
    parent_id: 0,
  };
}

function createLiveTvData(overrides: Partial<LiveTvData> = {}): LiveTvData {
  const streams = [
    mockStream(1, 'TF1', 'cat1'),
    mockStream(2, 'France 2', 'cat1'),
    mockStream(3, 'M6', 'cat2'),
    mockStream(4, 'Canal+', 'cat2'),
    mockStream(5, 'Arte', 'cat3'),
  ];

  return {
    categories: [mockCategory('cat1', 'Françaises'), mockCategory('cat2', 'Divertissement'), mockCategory('cat3', 'Culture')],
    streams,
    currentChannel: streams[0],
    currentCategoryId: 'cat1',
    favorites: new Set<number>([1, 5]),
    pinnedCategories: new Set<string>(),
    togglePin: vi.fn(),
    totalChannels: streams.length,
    ...overrides,
  };
}

// ============================================================================
// TESTS
// ============================================================================

describe('useChannelSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock getComputedStyle pour computeLeftMarginRatio
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      fontSize: '16px',
    } as CSSStyleDeclaration);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // ÉTAT INITIAL
  // ========================================================================

  it('commence fermé (isOpen = false)', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    expect(result.current.isOpen).toBe(false);
  });

  it('leftMarginRatio est 0 quand fermé', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    expect(result.current.leftMarginRatio).toBe(0);
  });

  it('fonctionne sans liveTvData (undefined)', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: undefined })
    );
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filteredChannels).toEqual([]);
  });

  // ========================================================================
  // TOGGLE / OPEN / CLOSE
  // ========================================================================

  it('toggle() ouvre le switcher', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
  });

  it('open pré-sélectionne la catégorie de la chaîne en cours', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData({ currentCategoryId: 'cat2' }) })
    );
    act(() => result.current.toggle());
    expect(result.current.selectedCategoryId).toBe('cat2');
  });

  it('open appelle setVideoMarginRatio avec un ratio > 0', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle());
    expect(mockSetVideoMarginRatio).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number), right: 0, top: 0, bottom: 0 })
    );
    const callArg = mockSetVideoMarginRatio.mock.calls[0][0];
    expect(callArg.left).toBeGreaterThan(0);
  });

  // Sur une vraie télé, le contenu de la colonne des catégories rentre dans la zone sûre (5 % à gauche) :
  // la colonne s'élargit d'autant dans tv.css, et la vidéo doit se réduire d'autant, sinon elle passe dessous.
  it('sur TV, réduit la vidéo de la zone sûre en plus des deux panneaux', () => {
    const largeur = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    try {
      const ouvrir = () => {
        mockSetVideoMarginRatio.mockClear();
        const { result } = renderHook(() => useChannelSwitcher({ liveTvData: createLiveTvData() }));
        act(() => result.current.toggle());
        return mockSetVideoMarginRatio.mock.calls[0][0].left as number;
      };
      setTvMode(false);
      const bureau = ouvrir();
      // 18vw + 22vw sur 1280 px, dans leurs bornes
      expect(bureau).toBeCloseTo(0.4, 5);
      setTvMode(true);
      expect(ouvrir()).toBeCloseTo(bureau + TV_SAFE_X_RATIO, 5);
      expect(TV_SAFE_X_RATIO).toBe(0.05);
    } finally {
      setTvMode(false);
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: largeur });
    }
  });

  it('toggle() ferme le switcher s\'il est ouvert', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle()); // open
    act(() => result.current.toggle()); // close
    expect(result.current.isOpen).toBe(false);
  });

  it('close() remet les marges MPV à zéro', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle()); // open
    mockSetVideoMarginRatio.mockClear();
    act(() => result.current.close());
    expect(mockSetVideoMarginRatio).toHaveBeenCalledWith({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('leftMarginRatio revient à 0 quand fermé', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle()); // open
    expect(result.current.leftMarginRatio).toBeGreaterThan(0);
    act(() => result.current.close()); // close
    expect(result.current.leftMarginRatio).toBe(0);
  });

  it('toggle() ne fait rien si liveTvData est undefined', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: undefined })
    );
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
    expect(mockSetVideoMarginRatio).not.toHaveBeenCalled();
  });

  // ========================================================================
  // ESCAPE HANDLER
  // ========================================================================

  it('Escape ferme le switcher quand ouvert', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle()); // open
    expect(result.current.isOpen).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('Escape ne fait rien quand fermé', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('les autres touches ne ferment pas le switcher', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );
    act(() => result.current.toggle()); // open

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(result.current.isOpen).toBe(true);
  });

  // ========================================================================
  // FILTRAGE PAR CATÉGORIE
  // ========================================================================

  it('filteredChannels retourne toutes les chaînes quand aucune catégorie sélectionnée', () => {
    const liveTvData = createLiveTvData();
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData })
    );
    // selectedCategoryId est '' par défaut → toutes les chaînes
    expect(result.current.filteredChannels).toHaveLength(5);
  });

  it('selectCategory filtre les chaînes par catégorie', () => {
    const liveTvData = createLiveTvData();
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData })
    );

    act(() => result.current.selectCategory('cat2'));

    expect(result.current.filteredChannels).toHaveLength(2);
    expect(result.current.filteredChannels.map(c => c.name)).toEqual(['M6', 'Canal+']);
  });

  it('selectCategory("favorites") filtre les favoris', () => {
    const liveTvData = createLiveTvData({ favorites: new Set([1, 5]) });
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData })
    );

    act(() => result.current.selectCategory('favorites'));

    expect(result.current.filteredChannels).toHaveLength(2);
    expect(result.current.filteredChannels.map(c => c.name)).toEqual(['TF1', 'Arte']);
  });

  it('selectCategory avec une catégorie inexistante retourne un tableau vide', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );

    act(() => result.current.selectCategory('cat_inexistante'));

    expect(result.current.filteredChannels).toHaveLength(0);
  });

  // ========================================================================
  // ACTIVE CHANNEL ID
  // ========================================================================

  it('activeChannelId correspond au stream_id de la chaîne en cours', () => {
    const streams = [mockStream(42, 'BeIN', 'cat1')];
    const liveTvData = createLiveTvData({
      currentChannel: streams[0],
      streams,
    });
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData })
    );
    expect(result.current.activeChannelId).toBe(42);
  });

  it('activeChannelId est \'\' quand liveTvData est undefined', () => {
    const { result } = renderHook(() =>
      useChannelSwitcher({ liveTvData: undefined })
    );
    expect(result.current.activeChannelId).toBe('');
  });

  // ========================================================================
  // CLEANUP AU DÉMONTAGE
  // ========================================================================

  it('reset les marges MPV au démontage si ouvert', () => {
    const { result, unmount } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );

    act(() => result.current.toggle()); // open
    mockSetVideoMarginRatio.mockClear();

    unmount();

    expect(mockSetVideoMarginRatio).toHaveBeenCalledWith({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('ne reset PAS les marges au démontage si fermé', () => {
    const { unmount } = renderHook(() =>
      useChannelSwitcher({ liveTvData: createLiveTvData() })
    );

    unmount();

    // Aucun appel car isOpen est resté false
    expect(mockSetVideoMarginRatio).not.toHaveBeenCalled();
  });
});
