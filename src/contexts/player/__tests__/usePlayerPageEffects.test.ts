/**
 * usePlayerPageEffects : la page passe en plein écran (encoche comprise) pendant une lecture sur
 * iPhone, et seulement là. Android règle les marges du WebView lui-même (plugin), Windows n'en a pas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PlayableItem } from '../../../types/player';

const { platform } = vi.hoisted(() => ({ platform: { os: 'ios' as 'android' | 'ios' | 'windows' } }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../services/playbackActivity', () => ({ setPlaybackBusy: vi.fn() }));
vi.mock('../../../utils/platform', () => ({ isIos: () => platform.os === 'ios' }));

import { usePlayerPageEffects } from '../usePlayerPageEffects';

const BASE = 'width=device-width, initial-scale=1.0';
const item = { stream_id: 1, name: 'Chaîne 1' } as unknown as PlayableItem;
const viewport = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

describe('usePlayerPageEffects : plein écran de la page', () => {
  beforeEach(() => {
    document.head.innerHTML = `<meta name="viewport" content="${BASE}" />`;
  });

  it('iOS : viewport-fit=cover pendant la lecture, retiré à la fermeture', () => {
    platform.os = 'ios';
    const { rerender, unmount } = renderHook(({ playing }) => usePlayerPageEffects(playing, false), {
      initialProps: { playing: item as PlayableItem | null },
    });
    expect(viewport()).toContain('viewport-fit=cover');
    rerender({ playing: null });
    expect(viewport()).toBe(BASE);
    unmount();
  });

  it.each(['android', 'windows'] as const)('%s : la page garde son viewport', (os) => {
    platform.os = os;
    const { unmount } = renderHook(() => usePlayerPageEffects(item, false));
    expect(viewport()).toBe(BASE);
    unmount();
  });
});
