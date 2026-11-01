/**
 * Chaîne + / − (télécommande, assistant, casque) : chaîne voisine dans la catégorie en cours,
 * la liste boucle.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useZapChannel } from '../useZapChannel';
import type { LiveTvData } from '../useChannelSwitcher';
import type { IptvStream } from '../../types/iptv';

const channel = (id: number, category = 'c1') => ({ stream_id: id, name: `Chaîne ${id}`, category_id: category }) as unknown as IptvStream;
const STREAMS = [channel(1), channel(2), channel(3), channel(9, 'c2')];
const data = (current: IptvStream): LiveTvData => ({
  categories: [], streams: STREAMS, currentChannel: current, currentCategoryId: 'c1', favorites: new Set(),
}) as unknown as LiveTvData;

describe('useZapChannel', () => {
  it('passe à la chaîne suivante ou précédente de la catégorie', () => {
    const switchChannel = vi.fn();
    const { result } = renderHook(() => useZapChannel(data(STREAMS[1]), switchChannel));
    result.current(1);
    result.current(-1);
    expect(switchChannel.mock.calls.map(([c]) => c.stream_id)).toEqual([3, 1]);
  });

  it('boucle aux extrémités, sans sortir de la catégorie', () => {
    const switchChannel = vi.fn();
    const { result } = renderHook(() => useZapChannel(data(STREAMS[2]), switchChannel));
    result.current(1);
    expect(switchChannel).toHaveBeenCalledWith(STREAMS[0]);
  });

  it('ne fait rien hors direct ni avec une seule chaîne', () => {
    const switchChannel = vi.fn();
    renderHook(() => useZapChannel(undefined, switchChannel)).result.current(1);
    renderHook(() => useZapChannel({ ...data(STREAMS[3]), currentCategoryId: 'c2' }, switchChannel)).result.current(1);
    expect(switchChannel).not.toHaveBeenCalled();
  });
});
