/**
 * Recherche à la télécommande : au bout de la rangée des chaînes TV, Droite doit
 * rester bloqué et Gauche revenir sur la barre latérale, sans monter sur la rangée des séries, plus
 * large et au-dessus. La rangée des chaînes doit donc être un étage de navigation, comme les autres
 * carrousels.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { TvCarouselSection } from '../GlobalSearchPage';
import { installSpatialNavigation } from '../../utils/spatialNavigation';
import type { LightLive } from '../../types/lightIndex';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }), initReactI18next: { type: '3rdParty', init: () => {} } }));
vi.mock('../GlobalSearchPage.css', () => ({}));
vi.mock('../../components/Tv/ChannelCard', () => ({
  default: ({ channelName }: { channelName: string }) => <button type="button">{channelName}</button>,
}));
vi.mock('../../hooks/useInertiaScroll', () => ({
  useInertiaScroll: () => ({ ref: { current: null }, isDragging: false, handleMouseDown: () => {}, dragStarted: false }),
}));

const rect = (x: number, y: number, w: number, h: number) =>
  ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;

let uninstall: () => void = () => {};
beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.scrollIntoView = vi.fn();
  uninstall = installSpatialNavigation();
});
afterEach(() => uninstall());

const arrow = (k: string) => {
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
};

function page() {
  const sidebar = document.createElement('nav');
  sidebar.setAttribute('data-nav-zone', 'sidebar');
  const icon = document.createElement('button');
  icon.className = 'active';
  sidebar.appendChild(icon);
  icon.getBoundingClientRect = () => rect(0, 300, 60, 60);
  document.body.appendChild(sidebar);

  // Rangée des séries, plus large que celle des chaînes, au-dessus
  const series = document.createElement('div');
  series.setAttribute('data-nav-row', '');
  document.body.appendChild(series);
  for (let i = 0; i < 6; i++) {
    const b = document.createElement('button');
    series.appendChild(b);
    b.getBoundingClientRect = () => rect(100 + i * 160, 100, 140, 200);
  }

  const items = [1, 2, 3].map((id) => ({ id, name: `C${id}` })) as unknown as LightLive[];
  const { container } = render(
    <TvCarouselSection items={items} onPlay={() => {}} prefixes={[]} favorites={new Set()} onToggleFavorite={() => {}} />,
  );
  document.body.appendChild(container);
  const cards = [...container.querySelectorAll<HTMLElement>('button')];
  cards.forEach((c, i) => { c.getBoundingClientRect = () => rect(100 + i * 160, 400, 140, 100); });
  return { icon, cards };
}

describe('Recherche : rangée des chaînes TV', () => {
  it('Droite au bout de la rangée reste bloqué (ne monte pas sur les séries)', () => {
    const { cards } = page();
    cards[2].focus();
    arrow('ArrowRight');
    expect(document.activeElement).toBe(cards[2]);
  });

  it('Gauche au début de la rangée revient sur la barre latérale', () => {
    const { icon, cards } = page();
    cards[0].focus();
    arrow('ArrowLeft');
    expect(document.activeElement).toBe(icon);
  });
});
