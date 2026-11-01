/**
 * Barre de progression : au doigt, la position suit le glisser et la lecture ne saute qu'au lâcher,
 * une seule fois ; à la souris, un clic saute directement.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useProgressScrub } from '../useProgressScrub';

const bar = { getBoundingClientRect: () => ({ left: 100, width: 200 }) } as unknown as HTMLDivElement;
const pointer = (pointerType: string, clientX: number) => ({
  pointerType, clientX, pointerId: 1, currentTarget: { setPointerCapture: vi.fn() },
}) as unknown as React.PointerEvent<HTMLDivElement>;
const click = (pointerType: string) => ({ nativeEvent: { pointerType } }) as unknown as React.MouseEvent<HTMLDivElement>;

function setup(duration = 100) {
  const seek = vi.fn(async () => undefined);
  const resetHideTimer = vi.fn();
  const hook = renderHook(() => useProgressScrub({ current: bar }, duration, resetHideTimer, seek));
  return { hook, seek, resetHideTimer };
}

describe('useProgressScrub', () => {
  it('au doigt : suit le glisser, saute au lâcher, ignore le clic qui suit', () => {
    const { hook, seek, resetHideTimer } = setup();
    act(() => hook.result.current.onPointerDown(pointer('touch', 150)));
    expect(hook.result.current.scrubPercent).toBe(25);
    act(() => hook.result.current.onPointerMove(pointer('touch', 400)));
    expect(hook.result.current.scrubPercent).toBe(100);
    expect(resetHideTimer).toHaveBeenCalled();
    act(() => hook.result.current.onPointerUp(pointer('touch', 400)));
    expect(hook.result.current.scrubPercent).toBeNull();
    act(() => hook.result.current.onClick(click('touch')));
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it('à la souris : pas de glisser, le clic saute', () => {
    const { hook, seek } = setup();
    act(() => hook.result.current.onPointerDown(pointer('mouse', 150)));
    expect(hook.result.current.scrubPercent).toBeNull();
    act(() => hook.result.current.onClick(click('mouse')));
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it('durée inconnue ou glisser annulé : aucun saut', () => {
    const { hook, seek } = setup(0);
    act(() => hook.result.current.onPointerDown(pointer('touch', 150)));
    expect(hook.result.current.scrubPercent).toBeNull();
    const other = setup();
    act(() => other.hook.result.current.onPointerDown(pointer('touch', 150)));
    act(() => other.hook.result.current.onPointerCancel());
    act(() => other.hook.result.current.onPointerUp(pointer('touch', 150)));
    expect(seek).not.toHaveBeenCalled();
    expect(other.seek).not.toHaveBeenCalled();
  });
});
