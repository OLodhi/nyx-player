/**
 * Rotation de la bannière d'accueil : un film toutes les 18 s, en pause tant que la bannière est tenue
 * (souris dessus, focus de la télécommande dedans), puis un tour complet après l'avoir quittée (sinon
 * le film changeait sous la sélection, « Ma liste » visait un autre film).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHeroRotation } from '../useHeroRotation';
import type { HeroMovie } from '../../types/dashboard';

const films = [1, 2, 3].map((id) => ({ id, title: `Film ${id}` })) as unknown as HeroMovie[];
const avancer = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('useHeroRotation', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('change de film toutes les 18 s', () => {
    const { result } = renderHook(() => useHeroRotation(films));
    avancer(18_500);
    expect(result.current.heroIndex).toBe(1);
  });

  it('tenue : aucun changement, même longtemps ; relâchée : un tour complet avant le film suivant', () => {
    const { result } = renderHook(() => useHeroRotation(films));
    avancer(10_000);
    act(() => result.current.setHeld(true));
    avancer(60_000);
    expect(result.current.heroIndex).toBe(0);
    act(() => result.current.setHeld(false));
    avancer(17_000);
    expect(result.current.heroIndex).toBe(0);
    avancer(1_500);
    expect(result.current.heroIndex).toBe(1);
  });

  it('un point choisi pendant que la bannière est tenue ne relance pas la rotation', () => {
    const { result } = renderHook(() => useHeroRotation(films));
    act(() => result.current.setHeld(true));
    act(() => result.current.handleDotClick(2));
    avancer(500);
    expect(result.current.heroIndex).toBe(2);
    avancer(40_000);
    expect(result.current.heroIndex).toBe(2);
  });

  it('accueil caché (fiche ou lecture par-dessus) : aucun changement ; de retour : un tour complet', () => {
    const { result, rerender } = renderHook(({ paused }) => useHeroRotation(films, paused), {
      initialProps: { paused: false },
    });
    avancer(10_000);
    rerender({ paused: true });
    avancer(120_000);
    expect(result.current.heroIndex).toBe(0);
    rerender({ paused: false });
    avancer(17_000);
    expect(result.current.heroIndex).toBe(0);
    avancer(1_500);
    expect(result.current.heroIndex).toBe(1);
  });

  it('caché puis relâché par la télécommande : toujours aucun changement', () => {
    const { result, rerender } = renderHook(({ paused }) => useHeroRotation(films, paused), {
      initialProps: { paused: true },
    });
    act(() => result.current.setHeld(true));
    act(() => result.current.setHeld(false));
    avancer(40_000);
    expect(result.current.heroIndex).toBe(0);
    rerender({ paused: false });
    avancer(18_500);
    expect(result.current.heroIndex).toBe(1);
  });

  it('de retour sur l\'accueil avec la bannière encore tenue : toujours aucun changement', () => {
    const { result, rerender } = renderHook(({ paused }) => useHeroRotation(films, paused), {
      initialProps: { paused: true },
    });
    act(() => result.current.setHeld(true));
    rerender({ paused: false });
    avancer(40_000);
    expect(result.current.heroIndex).toBe(0);
  });
});
