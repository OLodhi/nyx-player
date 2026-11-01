/**
 * Tests pour ChannelSwitcherCompact.tsx et TvCategoryList.tsx — liste rapide des chaînes sur téléphone
 *
 * Régression : les épinglées avaient leur propre zone et écrasaient les autres catégories ; la liste
 * rouvrait parfois sur les catégories au lieu des chaînes.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TvCategoryList from '../TvCategoryList';
import ChannelSwitcherCompact from '../ChannelSwitcherCompact';
import type { LiveTvData } from '../../../hooks/useChannelSwitcher';
import type { IptvStream } from '../../../types/iptv';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../../services/liveTvBookmarksService', () => ({
  getFavorites: () => new Set<number>(),
  toggleFavorite: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/preferencesService', () => ({
  isEpgEnabled: () => false,
}));

const categories = [
  { category_id: '1', category_name: 'FR | Sport', parent_id: 0 },
  { category_id: '2', category_name: 'FR | Info', parent_id: 0 },
  { category_id: '3', category_name: 'FR | Cinéma', parent_id: 0 },
];

const channel = (id: number, category: string): IptvStream =>
  ({ stream_id: id, name: `Chaîne ${id}`, category_id: category }) as unknown as IptvStream;

function liveTvData(pinned: string[] = []): LiveTvData {
  const streams = [channel(10, '1'), channel(11, '1'), channel(20, '2')];
  return {
    categories,
    streams,
    currentChannel: streams[1],
    currentCategoryId: '1',
    favorites: new Set(),
    pinnedCategories: new Set(pinned),
    togglePin: vi.fn(),
    totalChannels: streams.length,
  };
}

describe('TvCategoryList', () => {
  it('une seule liste : favoris, épinglées, puis toutes les catégories', () => {
    const { container } = render(
      <TvCategoryList
        categories={categories}
        selectedCategory="1"
        onSelectCategory={vi.fn()}
        pinnedCategoryIds={new Set(['2'])}
        onTogglePin={vi.fn()}
        totalChannels={3}
      />,
    );
    expect(container.querySelectorAll('ul')).toHaveLength(1);
    const labels = [...container.querySelectorAll('.tv-cat-list__label')].map((l) => l.textContent);
    expect(labels).toEqual(['sidebar_pinned', 'sidebar_all 3']);
    const items = [...container.querySelectorAll('.tv-cat-list__item')].map((i) => i.textContent);
    expect(items).toEqual(['sidebar_favorites', 'FR | Info', 'FR | Sport', 'FR | Info', 'FR | Cinéma']);
  });

  it('recherche : catégories filtrées, épinglées non répétées', () => {
    const { container } = render(
      <TvCategoryList
        categories={categories}
        selectedCategory="1"
        onSelectCategory={vi.fn()}
        pinnedCategoryIds={new Set(['2'])}
        onTogglePin={vi.fn()}
        totalChannels={3}
        query="ciné"
      />,
    );
    const items = [...container.querySelectorAll('.tv-cat-list__item')].map((i) => i.textContent);
    expect(items).toEqual(['sidebar_favorites', 'FR | Cinéma']);
  });
});

describe('ChannelSwitcherCompact', () => {
  const props = (isOpen: boolean, onSelectCategory = vi.fn()) => {
    const data = liveTvData(['2']);
    return {
      liveTvData: data,
      isOpen,
      selectedCategoryId: '1',
      onSelectCategory,
      filteredChannels: data.streams.filter((s) => String(s.category_id) === '1'),
      activeChannelId: 11,
      onChannelClick: vi.fn(),
      onClose: vi.fn(),
    };
  };

  it('en tête : catégorie en cours et nombre de chaînes', () => {
    render(<ChannelSwitcherCompact {...props(true)} />);
    const picker = screen.getByRole('button', { expanded: false });
    expect(picker.textContent).toContain('FR | Sport');
    expect(picker.textContent).toContain('2');
  });

  it('choisir une catégorie la sélectionne et ramène aux chaînes', () => {
    const onSelectCategory = vi.fn();
    const { container } = render(<ChannelSwitcherCompact {...props(true, onSelectCategory)} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const list = container.querySelector('.tv-cat-list') as HTMLElement;
    fireEvent.click(within(list).getAllByText('FR | Info')[0]);
    expect(onSelectCategory).toHaveBeenCalledWith('2');
    expect(container.querySelector('.tv-cat-list')).toBeNull();
  });

  it('refermée pendant le choix de catégorie : rouvre sur les chaînes', () => {
    const { container, rerender } = render(<ChannelSwitcherCompact {...props(true)} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.tv-cat-list')).not.toBeNull();
    rerender(<ChannelSwitcherCompact {...props(false)} />);
    rerender(<ChannelSwitcherCompact {...props(true)} />);
    expect(container.querySelector('.tv-cat-list')).toBeNull();
  });
});
