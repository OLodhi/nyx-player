/**
 * Guide TV : programme surligné « en direct »
 *
 * Régression : l'heure servant au surlignage était figée à l'ouverture du guide. Guide laissé ouvert
 * (fréquent sur TV), le repère rouge de l'heure avançait mais le surlignage restait sur le programme
 * d'avant jusqu'à la fermeture.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { GuideTvGrid } from '../GuideTvGrid';
import { nextLiveChangeSec } from '../guideLive';
import type { IptvStream } from '../../../types/iptv';
import type { EpgProgram } from '../../../services/epgService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const H = 3600;
const ORIGIN = 1_790_000_000 - (1_790_000_000 % 86400); // minuit UTC

const prog = (id: number, startH: number, stopH: number): EpgProgram => ({
  channelId: `c${id}`,
  title: `P${id} ${startH}`,
  startTs: ORIGIN + startH * H,
  stopTs: ORIGIN + stopH * H,
});

const liveTitle = () => document.querySelector('.guide-program--live .guide-program__title')?.textContent;

afterEach(() => {
  vi.useRealTimers();
});

describe('GuideTvGrid — programme « en direct »', () => {
  it("suit l'heure quand le guide reste ouvert", () => {
    vi.useFakeTimers();
    vi.setSystemTime((ORIGIN + 20.75 * H) * 1000); // 20 h 45
    const programs = new Map([['c1', [prog(1, 20, 21), prog(1, 21, 22)]]]);
    render(
      <GuideTvGrid
        channels={[{ stream_id: 1, name: 'Chaîne 1', epg_channel_id: 'c1' } as unknown as IptvStream]}
        onChannelClick={vi.fn()}
        programs={programs}
        originTs={ORIGIN}
        totalMinutes={1440}
        isLoading={false}
        error={null}
        loadDay={vi.fn().mockResolvedValue(undefined)}
        loadedDays={new Set([ORIGIN])}
      />,
    );
    expect(liveTitle()).toBe('P1 20');

    act(() => { vi.advanceTimersByTime(30 * 60_000); }); // 21 h 15, sans autre redessin
    expect(liveTitle()).toBe('P1 21');
  });

  it('relit l\'heure au retour au premier plan (appareil sorti de veille)', () => {
    vi.useFakeTimers();
    vi.setSystemTime((ORIGIN + 20.75 * H) * 1000); // 20 h 45
    render(
      <GuideTvGrid
        channels={[{ stream_id: 1, name: 'Chaîne 1', epg_channel_id: 'c1' } as unknown as IptvStream]}
        onChannelClick={vi.fn()}
        programs={new Map([['c1', [prog(1, 20, 21), prog(1, 21, 22)]]])}
        originTs={ORIGIN}
        totalMinutes={1440}
        isLoading={false}
        error={null}
        loadDay={vi.fn().mockResolvedValue(undefined)}
        loadedDays={new Set([ORIGIN])}
      />,
    );
    vi.setSystemTime((ORIGIN + 21.25 * H) * 1000); // veille : l'heure avance, aucun minuteur ne part
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(liveTitle()).toBe('P1 21');
  });

  it('prochain changement : le plus proche début ou fin de programme après maintenant', () => {
    const programs = new Map([
      ['c1', [prog(1, 20, 21), prog(1, 21, 22)]],
      ['c2', [prog(2, 19, 20.5), prog(2, 20.5, 23)]],
    ]);
    expect(nextLiveChangeSec(programs, ORIGIN + 20.25 * H)).toBe(ORIGIN + 20.5 * H);
    expect(nextLiveChangeSec(programs, ORIGIN + 20.5 * H)).toBe(ORIGIN + 21 * H);
    expect(nextLiveChangeSec(programs, ORIGIN + 23 * H)).toBeNull();
  });
});

describe('GuideTvGrid — jour précédent (Chromecast)', () => {
  it("ne dessine pas les programmes finis avant minuit, qui s'empilaient à gauche de la grille", () => {
    const programs = new Map([['c1', [
      prog(1, -3, -2), // hier soir, fini avant l'origine
      prog(1, -1, 1), // à cheval sur minuit : visible
      prog(1, 1, 2),
    ]]]);
    render(
      <GuideTvGrid
        channels={[{ stream_id: 1, name: 'Chaîne 1', epg_channel_id: 'c1' } as unknown as IptvStream]}
        onChannelClick={vi.fn()}
        programs={programs}
        originTs={ORIGIN}
        totalMinutes={1440}
        isLoading={false}
        error={null}
        loadDay={vi.fn().mockResolvedValue(undefined)}
        loadedDays={new Set([ORIGIN - 86400, ORIGIN])}
      />,
    );
    const titles = [...document.querySelectorAll('.guide-program__title')].map((el) => el.textContent);
    expect(titles).toEqual(['P1 -1', 'P1 1']);
  });
});
