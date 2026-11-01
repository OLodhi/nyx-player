/**
 * useGridEpg — une réponse en retard ne remplace plus les programmes de la catégorie affichée.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { IptvStream } from '../../types/iptv';
import type { EpgNowInfo } from '../../services/epgService';

const pending: { ids: string[]; resolve: (m: Map<string, EpgNowInfo>) => void }[] = [];
vi.mock('../../services/epgService', () => ({
  getBatchNowPrograms: vi.fn(
    (ids: string[]) => new Promise<Map<string, EpgNowInfo>>((resolve) => { pending.push({ ids, resolve }); }),
  ),
}));

import { useGridEpg } from '../useGridEpg';
import { EPG_UPDATED_EVENT } from '../../services/eventConstants';

const channel = (epg: string) => ({ epg_channel_id: epg } as unknown as IptvStream);
const info = (title: string): EpgNowInfo => ({ title, startTs: 0, stopTs: 1, progress: 0 });
const answer = (index: number, title: string) =>
  act(async () => {
    const request = pending[index];
    request.resolve(new Map(request.ids.map((id) => [id, info(title)])));
    await Promise.resolve();
  });

beforeEach(() => {
  pending.length = 0;
});

describe('useGridEpg', () => {
  it('changement rapide de catégorie : la réponse de l\'ancienne arrivée en retard est ignorée', async () => {
    const sports = [channel('sport.fr')];
    const news = [channel('news.fr')];
    const { result, rerender } = renderHook(({ list }) => useGridEpg(list, true), { initialProps: { list: sports } });
    rerender({ list: news });
    expect(pending.map((p) => p.ids)).toEqual([['sport.fr'], ['news.fr']]);
    // La catégorie affichée répond d'abord, l'ancienne ensuite
    await answer(1, 'Journal');
    await answer(0, 'Match');
    expect([...result.current.keys()]).toEqual(['news.fr']);
    expect(result.current.get('news.fr')?.title).toBe('Journal');
  });

  it('guide mis à jour puis changement de catégorie : la réponse pour l\'ancienne liste est ignorée', async () => {
    const sports = [channel('sport.fr')];
    const news = [channel('news.fr')];
    const { result, rerender } = renderHook(({ list }) => useGridEpg(list, true), { initialProps: { list: sports } });
    await answer(0, 'Match');
    act(() => { window.dispatchEvent(new Event(EPG_UPDATED_EVENT)); });
    rerender({ list: news });
    await answer(2, 'Journal');
    await answer(1, 'Match mis à jour');
    expect(result.current.get('news.fr')?.title).toBe('Journal');
    expect(result.current.has('sport.fr')).toBe(false);
  });
});
