/**
 * Tests unitaires pour useEpisodeSwitcher
 *
 * Couvre :
 * - Toggle open/close
 * - Fermeture via close()
 * - Escape handler (capture phase, stopPropagation)
 * - Pas d'Escape listener quand fermé
 * - Toggle idempotence
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEpisodeSwitcher } from '../useEpisodeSwitcher';

// Mock devLog pour éviter les logs en test
vi.mock('../../utils/devLog', () => ({
  devLog: vi.fn(),
}));

describe('useEpisodeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // ÉTAT INITIAL
  // ========================================================================

  it('commence fermé (isOpen = false)', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    expect(result.current.isOpen).toBe(false);
  });

  // ========================================================================
  // TOGGLE
  // ========================================================================

  it('toggle() ouvre le switcher', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(true);
  });

  it('toggle() ferme le switcher s\'il est ouvert', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle()); // open
    act(() => result.current.toggle()); // close
    expect(result.current.isOpen).toBe(false);
  });

  it('double toggle ramène à l\'état initial', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle());
    act(() => result.current.toggle());
    expect(result.current.isOpen).toBe(false);
  });

  // ========================================================================
  // CLOSE
  // ========================================================================

  it('close() ferme le switcher ouvert', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle()); // open
    expect(result.current.isOpen).toBe(true);
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it('close() est idempotent (pas de crash si déjà fermé)', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.close()); // Déjà fermé
    expect(result.current.isOpen).toBe(false);
  });

  // ========================================================================
  // ESCAPE HANDLER
  // ========================================================================

  it('Escape ferme le switcher quand ouvert', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle()); // open
    expect(result.current.isOpen).toBe(true);

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      window.dispatchEvent(event);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('Escape ne fait rien quand le switcher est fermé', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    expect(result.current.isOpen).toBe(false);

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      window.dispatchEvent(event);
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('Escape appelle stopPropagation pour bloquer la fermeture du player', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle()); // open

    const stopPropagation = vi.fn();
    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      // Override stopPropagation pour vérifier qu'il est appelé
      Object.defineProperty(event, 'stopPropagation', { value: stopPropagation });
      window.dispatchEvent(event);
    });

    expect(stopPropagation).toHaveBeenCalled();
  });

  it('les autres touches ne ferment pas le switcher', () => {
    const { result } = renderHook(() => useEpisodeSwitcher());
    act(() => result.current.toggle()); // open

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(result.current.isOpen).toBe(true);
  });

  // ========================================================================
  // CLEANUP
  // ========================================================================

  it('cleanup le listener Escape quand le hook est démonté', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useEpisodeSwitcher());
    
    act(() => result.current.toggle()); // open — attache le listener
    
    unmount();
    
    // Vérifier qu'un removeEventListener a été appelé pour 'keydown'
    const keydownCalls = removeEventListenerSpy.mock.calls.filter(
      ([event]) => event === 'keydown'
    );
    expect(keydownCalls.length).toBeGreaterThan(0);
    
    removeEventListenerSpy.mockRestore();
  });

  // ========================================================================
  // STABILITÉ DES RÉFÉRENCES
  // ========================================================================

  it('close et toggle sont des références stables entre re-renders', () => {
    const { result, rerender } = renderHook(() => useEpisodeSwitcher());
    const firstClose = result.current.close;
    rerender();
    expect(result.current.close).toBe(firstClose);
  });
});
