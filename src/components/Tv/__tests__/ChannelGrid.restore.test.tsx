/**
 * Retour du lecteur sur TV : la grille ramène le focus sur la
 * chaîne lancée, au lieu de laisser la télécommande repartir de la première carte.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import type { IptvStream } from '../../../types/iptv';

const scrollToItem = vi.fn();
const grille = vi.hoisted(() => ({ columnCount: 0 }));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../hooks/useGridEpg', () => ({ useGridEpg: () => new Map() }));
vi.mock('../../../services/preferencesService', () => ({ isEpgEnabled: () => false }));
vi.mock('../../../services/liveTvBookmarksService', () => ({
  getFavorites: () => new Set<number>(),
  toggleFavorite: vi.fn(),
}));
// Grille simulée : toutes les cellules sont dessinées, `scrollToItem` est espionné
vi.mock('react-window', async () => {
  const React = await import('react');
  const FixedSizeGrid = React.forwardRef<unknown, {
    columnCount: number; rowCount: number; itemData: unknown;
    children: React.ComponentType<{ columnIndex: number; rowIndex: number; style: React.CSSProperties; data: unknown }>;
  }>(function Grid({ columnCount, rowCount, itemData, children: Cell }, ref) {
    grille.columnCount = columnCount;
    React.useImperativeHandle(ref, () => ({ scrollToItem }));
    const cells = [];
    for (let r = 0; r < rowCount; r += 1) {
      for (let c = 0; c < columnCount; c += 1) cells.push(<Cell key={`${r}-${c}`} columnIndex={c} rowIndex={r} style={{}} data={itemData} />);
    }
    return <div>{cells}</div>;
  });
  return { FixedSizeGrid };
});

import ChannelGrid from '../ChannelGrid';

const channel = (id: number): IptvStream =>
  ({ num: id, name: `Chaîne ${id}`, stream_type: 'live', stream_id: id, stream_icon: '', added: '', category_id: '1', tmdb: 0 });
const CHANNELS = [1, 2, 3, 4, 5, 6, 7].map(channel);

let rafQueue: FrameRequestCallback[] = [];
const flushFrames = () => act(() => {
  for (let guard = 0; guard < 20 && rafQueue.length; guard += 1) {
    const run = rafQueue;
    rafQueue = [];
    run.forEach((cb) => cb(0));
  }
});

beforeEach(() => {
  rafQueue = [];
  scrollToItem.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQueue.push(cb); return rafQueue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1200 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 600 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
  document.body.innerHTML = '';
});

describe('ChannelGrid : retour du lecteur', () => {
  it('rend le focus à la chaîne lancée et ramène la grille dessus', () => {
    const { rerender } = render(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={6} returns={0} />);
    flushFrames();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);

    rerender(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={6} returns={1} />);
    flushFrames();
    // La chaîne 6 est à l'index 5 : ligne et colonne suivent le nombre de colonnes de la grille
    expect(scrollToItem).toHaveBeenCalledTimes(1);
    const { rowIndex, columnIndex } = scrollToItem.mock.calls[0][0] as { rowIndex: number; columnIndex: number };
    expect(rowIndex * grille.columnCount + columnIndex).toBe(5);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Chaîne 6');
  });

  it('ne reprend pas le focus si la télécommande a déjà bougé', () => {
    const { rerender } = render(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={6} returns={0} />);
    const autre = document.querySelector<HTMLElement>('[data-stream-id="2"] .channel-card')!;
    autre.focus();
    rerender(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={6} returns={1} />);
    flushFrames();
    expect(document.activeElement).toBe(autre);
  });

  it('sans chaîne mémorisée (autre catégorie), rien ne bouge', () => {
    const { rerender } = render(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={null} returns={0} />);
    rerender(<ChannelGrid channels={CHANNELS} onChannelClick={vi.fn()} restoreStreamId={null} returns={1} />);
    flushFrames();
    expect(scrollToItem).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });
});
