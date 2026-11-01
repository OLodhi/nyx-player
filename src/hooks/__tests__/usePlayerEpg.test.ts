/**
 * Bandeau du guide dans le lecteur : après un zap, il ne montre jamais le programme
 * de la chaîne précédente.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { getNowAndNextProgram } = vi.hoisted(() => ({ getNowAndNextProgram: vi.fn() }));
vi.mock('../../services/epgService', () => ({ getNowAndNextProgram }));
vi.mock('../../services/preferencesService', () => ({ isEpgEnabled: () => true }));

import { usePlayerEpg } from '../usePlayerEpg';
import type { IptvStream } from '../../types/iptv';

const channel = (epg: string) => ({ stream_id: 1, name: epg, epg_channel_id: epg }) as unknown as IptvStream;
const program = (title: string) => ({ title }) as never;

describe('usePlayerEpg — zap', () => {
  beforeEach(() => { getNowAndNextProgram.mockReset(); });

  it('réponse en retard de la chaîne précédente : ignorée', async () => {
    const answers: Record<string, (v: unknown) => void> = {};
    getNowAndNextProgram.mockImplementation((id: string) => new Promise((r) => { answers[id] = r; }));

    const { result, rerender } = renderHook(({ c }) => usePlayerEpg(c, true, true), { initialProps: { c: channel('tf1') } });
    rerender({ c: channel('fr2') });

    // La chaîne en cours répond, puis l'ancienne, plus lente
    await act(async () => { answers.fr2({ now: program('Journal France 2'), next: null }); });
    await act(async () => { answers.tf1({ now: program('Série TF1'), next: null }); });

    expect(result.current.nowProgram).toEqual(program('Journal France 2'));
  });

  it('au zap, le programme de la chaîne précédente disparaît avant la réponse', async () => {
    getNowAndNextProgram.mockResolvedValueOnce({ now: program('Série TF1'), next: null });
    const { result, rerender } = renderHook(({ c }) => usePlayerEpg(c, true, true), { initialProps: { c: channel('tf1') } });
    await act(async () => {});
    expect(result.current.nowProgram).toEqual(program('Série TF1'));

    getNowAndNextProgram.mockImplementation(() => new Promise(() => {}));
    rerender({ c: channel('fr2') });
    expect(result.current.nowProgram).toBeNull();
    expect(result.current.isVisible).toBe(false);
  });
});
