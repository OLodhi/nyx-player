/**
 * useGuideTvData — un chargement encore en cours quand les données sont remises à zéro
 * (changement de catégorie, synchro EPG) est ignoré : ses programmes ne se mêlent pas
 * aux nouveaux et son échec ne retire pas un jour des nouvelles données. Un programme
 * à cheval sur minuit, renvoyé par les deux jours, n'est gardé qu'une fois.
 * Un jour supplémentaire arrivé avant le chargement du jour courant n'est pas effacé par lui.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { IptvStream } from '../../types/iptv';
import type { EpgProgram } from '../../services/epgService';

interface Pending {
  ids: string[];
  day: number;
  resolve: (m: Map<string, EpgProgram[]>) => void;
  reject: (e: Error) => void;
}

const pending: Pending[] = [];
vi.mock('../../services/epgService', () => ({
  getDayPrograms: vi.fn(
    (ids: string[], day: number) =>
      new Promise<Map<string, EpgProgram[]>>((resolve, reject) => { pending.push({ ids, day, resolve, reject }); }),
  ),
}));

import { useGuideTvData } from '../useGuideTvData';
import { EPG_UPDATED_EVENT } from '../../services/eventConstants';

const channel = (epg: string) => ({ epg_channel_id: epg } as unknown as IptvStream);
const program = (channelId: string, startTs: number): EpgProgram => ({
  channelId, title: `${channelId}@${startTs}`, startTs, stopTs: startTs + 3600,
});
const settle = (index: number) =>
  act(async () => {
    const request = pending[index];
    request.resolve(new Map(request.ids.map((id) => [id, [program(id, request.day)]])));
    await Promise.resolve();
  });
const fail = (index: number) =>
  act(async () => {
    pending[index].reject(new Error('réseau'));
    await Promise.resolve();
  });

const sports = [channel('sport.fr')];
const news = [channel('news.fr')];

beforeEach(() => {
  pending.length = 0;
});

describe('useGuideTvData', () => {
  it('un jour chargé pour l\'ancienne catégorie et arrivé en retard est ignoré', async () => {
    const { result, rerender } = renderHook(({ list }) => useGuideTvData(list), { initialProps: { list: sports } });
    await settle(0);
    const tomorrow = result.current.originTs + 86400;

    // Défilement : le lendemain part pour « sport », puis l'utilisateur change de catégorie.
    let stale: Promise<void> = Promise.resolve();
    act(() => { stale = result.current.loadDay(tomorrow); });
    rerender({ list: news });
    expect(pending.map((p) => p.ids)).toEqual([['sport.fr'], ['sport.fr'], ['news.fr']]);

    await settle(2);
    await settle(1);
    await act(async () => { await stale; });

    expect([...result.current.programs.keys()]).toEqual(['news.fr']);
    expect(result.current.totalMinutes).toBe(1440);
    // Le lendemain n'est pas marqué chargé pour « news » : il pourra être demandé.
    expect(result.current.loadedDays.has(tomorrow)).toBe(false);
    act(() => { void result.current.loadDay(tomorrow); });
    expect(pending[3]).toMatchObject({ ids: ['news.fr'], day: tomorrow });
  });

  it('l\'échec en retard d\'un jour de l\'ancienne catégorie ne retire pas ce jour à la nouvelle', async () => {
    const { result, rerender } = renderHook(({ list }) => useGuideTvData(list), { initialProps: { list: sports } });
    await settle(0);
    const tomorrow = result.current.originTs + 86400;

    let stale: Promise<void> = Promise.resolve();
    act(() => { stale = result.current.loadDay(tomorrow); });
    rerender({ list: news });
    await settle(2);
    act(() => { void result.current.loadDay(tomorrow); });
    expect(pending[3]).toMatchObject({ ids: ['news.fr'], day: tomorrow });

    await fail(1);
    await act(async () => { await stale; });
    await settle(3);

    expect(result.current.loadedDays.has(tomorrow)).toBe(true);
    expect(result.current.programs.get('news.fr')?.map((p) => p.startTs))
      .toEqual([result.current.originTs, tomorrow]);
  });

  it('le rechargement après synchro, encore en cours au changement de catégorie, est ignoré', async () => {
    const { result, rerender } = renderHook(({ list }) => useGuideTvData(list), { initialProps: { list: sports } });
    await settle(0);

    act(() => { window.dispatchEvent(new Event(EPG_UPDATED_EVENT)); });
    rerender({ list: news });
    expect(pending.map((p) => p.ids)).toEqual([['sport.fr'], ['sport.fr'], ['news.fr']]);

    await settle(2);
    await settle(1);

    expect([...result.current.programs.keys()]).toEqual(['news.fr']);
    expect(result.current.isLoading).toBe(false);
  });

  it('le chargement initial, encore en cours à la synchro, n\'efface rien de la synchro en échouant', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    const today = result.current.originTs;

    act(() => { window.dispatchEvent(new Event(EPG_UPDATED_EVENT)); });
    await fail(0);

    expect(result.current.loadedDays.has(today)).toBe(true);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
    await settle(1);
    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs)).toEqual([today]);
    expect(result.current.isLoading).toBe(false);
  });

  it('un jour chargé avant une synchro EPG et arrivé après est ignoré', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    await settle(0);
    const tomorrow = result.current.originTs + 86400;

    let stale: Promise<void> = Promise.resolve();
    act(() => { stale = result.current.loadDay(tomorrow); });
    act(() => { window.dispatchEvent(new Event(EPG_UPDATED_EVENT)); });
    await settle(2);
    await settle(1);
    await act(async () => { await stale; });

    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs)).toEqual([result.current.originTs]);
    expect(result.current.loadedDays.has(tomorrow)).toBe(false);
  });

  it('un jour chargé pour la catégorie affichée est bien ajouté', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    await settle(0);
    const tomorrow = result.current.originTs + 86400;

    let load: Promise<void> = Promise.resolve();
    act(() => { load = result.current.loadDay(tomorrow); });
    await settle(1);
    await act(async () => { await load; });

    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs))
      .toEqual([result.current.originTs, tomorrow]);
    expect(result.current.totalMinutes).toBe(2880);
  });

  it('un jour supplémentaire arrivé avant le chargement initial n\'est pas effacé par lui', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    const today = result.current.originTs;
    const tomorrow = today + 86400;

    let load: Promise<void> = Promise.resolve();
    act(() => { load = result.current.loadDay(tomorrow); });
    await settle(1);
    await act(async () => { await load; });
    await settle(0);

    expect(result.current.loadedDays.has(tomorrow)).toBe(true);
    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs)).toEqual([today, tomorrow]);
    expect(result.current.totalMinutes).toBe(2880);
  });

  it('un jour supplémentaire arrivé avant le rechargement après synchro n\'est pas effacé par lui', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    await settle(0);
    const today = result.current.originTs;
    const tomorrow = today + 86400;

    act(() => { window.dispatchEvent(new Event(EPG_UPDATED_EVENT)); });
    let load: Promise<void> = Promise.resolve();
    act(() => { load = result.current.loadDay(tomorrow); });
    await settle(2);
    await act(async () => { await load; });
    await settle(1);

    expect(result.current.loadedDays.has(tomorrow)).toBe(true);
    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs)).toEqual([today, tomorrow]);
  });

  it('un programme à cheval sur minuit, rendu par les deux jours, n\'est gardé qu\'une fois', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    const tomorrow = result.current.originTs + 86400;
    // 23:00 → 02:00 : la requête de chaque jour le renvoie (il chevauche les deux)
    const night: EpgProgram = { channelId: 'sport.fr', title: 'Nuit', startTs: tomorrow - 3600, stopTs: tomorrow + 7200 };
    await act(async () => {
      pending[0].resolve(new Map([['sport.fr', [{ ...night }]]]));
      await Promise.resolve();
    });

    let load: Promise<void> = Promise.resolve();
    act(() => { load = result.current.loadDay(tomorrow); });
    await act(async () => {
      pending[1].resolve(new Map([['sport.fr', [{ ...night }, program('sport.fr', tomorrow + 7200)]]]));
      await Promise.resolve();
    });
    await act(async () => { await load; });

    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs))
      .toEqual([tomorrow - 3600, tomorrow + 7200]);
  });

  it('un doublon du fournisseur dans un même jour chargé reste tel quel (rangé par le guide)', async () => {
    const { result } = renderHook(() => useGuideTvData(sports));
    await settle(0);
    const tomorrow = result.current.originTs + 86400;

    let load: Promise<void> = Promise.resolve();
    act(() => { load = result.current.loadDay(tomorrow); });
    await act(async () => {
      pending[1].resolve(new Map([['sport.fr', [program('sport.fr', tomorrow), program('sport.fr', tomorrow)]]]));
      await Promise.resolve();
    });
    await act(async () => { await load; });

    expect(result.current.programs.get('sport.fr')?.map((p) => p.startTs))
      .toEqual([result.current.originTs, tomorrow, tomorrow]);
  });
});
