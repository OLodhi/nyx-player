/**
 * Guide TV à la télécommande (Android TV) : la grille ne se parcourait pas aux flèches, le guide
 * n'était utilisable qu'à la souris (constaté au banc de test).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { GuideTvGrid } from '../GuideTvGrid';
import { installSpatialNavigation } from '../../../utils/spatialNavigation';
import { setTvMode } from '../../../utils/platform';
import type { IptvStream } from '../../../types/iptv';
import type { EpgProgram } from '../../../services/epgService';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const H = 3600;
const ORIGIN = 1_790_000_000 - (1_790_000_000 % 86400); // minuit UTC
const NOW = ORIGIN + 20.25 * H; // 20 h 15

const channel = (id: number): IptvStream =>
  ({ stream_id: id, name: `Chaîne ${id}`, epg_channel_id: `c${id}` }) as unknown as IptvStream;
const prog = (id: number, startH: number, stopH: number): EpgProgram => ({
  channelId: `c${id}`,
  title: `P${id} ${startH}`,
  startTs: ORIGIN + startH * H,
  stopTs: ORIGIN + stopH * H,
});

const channels = [channel(1), channel(2), channel(3)];
const basePrograms = () => new Map<string, EpgProgram[]>([
  ['c1', [prog(1, 18, 20), prog(1, 20, 21), prog(1, 21, 23)]],
  ['c2', [prog(2, 19, 20.5), prog(2, 20.5, 22)]],
  // Pas de guide
]);

function renderGuide(onChannelClick = vi.fn(), programs = basePrograms()) {
  const props = {
    channels,
    onChannelClick,
    programs,
    originTs: ORIGIN,
    totalMinutes: 1440,
    isLoading: false,
    error: null,
    loadDay: vi.fn().mockResolvedValue(undefined),
    loadedDays: new Set([ORIGIN]),
  };
  const view = render(<GuideTvGrid {...props} />);
  return { ...view, props };
}

/** Un appui complet : touche enfoncée puis relâchée (sans relâchement, un second OK serait une répétition). */
const press = (key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  });
  return event;
};

const focusedTitle = () => document.activeElement?.querySelector('.guide-program__title')?.textContent
  ?? document.activeElement?.getAttribute('aria-label');

const nativeScrollIntoView = Element.prototype.scrollIntoView;
let uninstall: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  Element.prototype.scrollIntoView = vi.fn();
  setTvMode(true);
  uninstall = installSpatialNavigation();
});

afterEach(() => {
  uninstall();
  setTvMode(false);
  vi.useRealTimers();
  Element.prototype.scrollIntoView = nativeScrollIntoView;
});

describe('GuideTvGrid à la télécommande', () => {
  it('une seule case est sur le parcours : le programme en cours de la première chaîne', () => {
    renderGuide();
    const entries = document.querySelectorAll('[data-guide-row][tabindex="0"]');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain('P1 20');
    expect(screen.getByTestId('guide-body').hasAttribute('data-nav-grid')).toBe(true);
  });

  it('flèches : programmes de la chaîne à gauche / droite, même heure en haut / bas', () => {
    renderGuide();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    expect(focusedTitle()).toBe('P1 20');

    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(focusedTitle()).toBe('P1 21');
    press('ArrowLeft');
    expect(focusedTitle()).toBe('P1 20');
    press('ArrowDown');
    expect(focusedTitle()).toBe('P2 19');
    // Chaîne sans guide : son logo
    press('ArrowDown');
    expect(focusedTitle()).toBe('Chaîne 3');
    press('ArrowUp');
    expect(focusedTitle()).toBe('P2 19');
  });

  // Bas maintenu dans le guide saccadait puis revenait en arrière sur le Chromecast. Android
  // répète la touche sans marquer les répétitions : chacune repartait animée, sans frein.
  it('flèche maintenue sur Android (répétitions non marquées) : freinée, sans défilement natif animé', () => {
    const hold = (key: string) => {
      act(() => {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    };
    const release = (key: string) => {
      act(() => {
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      });
    };
    const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    renderGuide();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowDown');
    press('ArrowDown');
    expect(focusedTitle()).toBe('Chaîne 3');

    later(500); // un vrai nouvel appui : les deux précédents ne comptent plus comme rapprochés
    hold('ArrowUp');
    expect(focusedTitle()).toBe('P2 19');
    later(250);
    hold('ArrowUp'); // répétition : la même animation change de cible
    expect(focusedTitle()).toBe('P1 20');
    expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    release('ArrowUp');

    hold('ArrowDown');
    expect(focusedTitle()).toBe('P2 19');
    later(50);
    hold('ArrowDown'); // répétition 50 ms après le dernier pas répété : freinée
    expect(focusedTitle()).toBe('P2 19');
  });

  /** Corps du guide qui défile, chaque case 400 px sous le haut du corps (jsdom ne calcule aucune géométrie). */
  function logoBody() {
    const body = screen.getByTestId('guide-body');
    let position = 0;
    Object.defineProperty(body, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 5000 });
    Object.defineProperty(body, 'clientHeight', { value: 400 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this === body ? 100 : 500;
      return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    return { position: () => position };
  }

  // Sur TV, la vue suit la sélection de la même façon sur les logos des chaînes que sur les programmes (avant, les
  // logos glissaient alors que les programmes sautaient d'un coup)
  it('TV, logos : le guide glisse jusqu’à la chaîne, comme sur les programmes', () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    vi.setSystemTime(NOW * 1000);
    renderGuide(vi.fn(), new Map());
    const view = logoBody();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowDown');
    expect(view.position()).toBe(0);
    act(() => { vi.advanceTimersByTime(1500); });
    // Centre de la case (510) au centre du corps (100 + 400 / 2)
    expect(view.position()).toBe(210);
    vi.restoreAllMocks();
  });

  // Défilements empilés : sur un logo, `moveFocus` n'est pas appelé, le guide conduit lui-même
  // le défilement ; le second appui change la cible de la même animation, la vue ne recule jamais.
  it('défilement animé, deux logos de suite : une seule animation, la vue ne recule jamais', async () => {
    renderGuide(vi.fn(), new Map()); // aucune chaîne n'a de guide : que des logos
    const body = screen.getByTestId('guide-body');
    let position = 0;
    Object.defineProperty(body, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 5000 });
    Object.defineProperty(body, 'clientHeight', { value: 400 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this === body ? 100 : 500;
      return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const scrollBy = vi.fn();
    body.scrollBy = scrollBy as unknown as typeof body.scrollBy;
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowDown');
    await new Promise((resolve) => setTimeout(resolve, 60));
    press('ArrowDown');
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      seen.push(position);
    }
    expect(scrollBy).not.toHaveBeenCalled();
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(position).toBeGreaterThan(200);
    vi.restoreAllMocks();
  });

  it('défilement animé, logos, flèche maintenue : la vue est animée (jamais téléportée) et ne recule pas', async () => {
    renderGuide(vi.fn(), new Map());
    const body = screen.getByTestId('guide-body');
    let position = 0;
    Object.defineProperty(body, 'scrollTop', { get: () => position, set: (v: number) => (position = v), configurable: true });
    Object.defineProperty(body, 'scrollHeight', { value: 5000 });
    Object.defineProperty(body, 'clientHeight', { value: 400 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = this === body ? 100 : 500;
      return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, repeat: true }));
    });
    expect(position).toBe(0); // pas de saut d'un coup
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(position).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it('la case quittée reste la seule sur le parcours (retour depuis la barre des catégories)', () => {
    renderGuide();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowDown');
    const entries = document.querySelectorAll('[data-guide-row][tabindex="0"]');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe(document.activeElement);
  });

  it('OK sur un programme ou sur un logo lance la chaîne', () => {
    const onChannelClick = vi.fn();
    renderGuide(onChannelClick);
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowDown');
    press('Enter');
    expect(onChannelClick).toHaveBeenLastCalledWith(channels[1]);
    press('ArrowLeft');
    press('ArrowLeft');
    expect(focusedTitle()).toBe('Chaîne 2');
    press('Enter');
    expect(onChannelClick).toHaveBeenCalledTimes(2);
    expect(onChannelClick).toHaveBeenLastCalledWith(channels[1]);
  });

  it('Gauche depuis un logo n\'est pas prise par le guide (la navigation habituelle mène à la barre)', () => {
    renderGuide();
    act(() => (document.querySelector('[data-guide-row="0"][data-guide-channel]') as HTMLElement).focus());
    const handled = vi.fn();
    screen.getByTestId('guide-body').addEventListener('nyx:nav-move', (event) => handled(event.defaultPrevented));
    press('ArrowLeft');
    expect(handled).toHaveBeenCalledWith(false);
  });

  it('un jour précédent chargé en tête ne recrée pas les programmes : la sélection reste', () => {
    const { rerender, props } = renderGuide();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    const focused = document.activeElement;
    const programs = basePrograms();
    programs.set('c1', [prog(1, -2, -1), ...programs.get('c1')!]);
    rerender(<GuideTvGrid {...props} programs={programs} />);
    expect(document.activeElement).toBe(focused);
    expect(focused?.isConnected).toBe(true);
  });

  it('un programme à cheval sur minuit, présent avec les deux jours chargés, ne bloque pas Droite', () => {
    const programs = basePrograms();
    const night = prog(1, 23, 25);
    programs.set('c1', [prog(1, 20, 21), prog(1, 21, 23), night, { ...night }, prog(1, 25, 26)]);
    renderGuide(vi.fn(), programs);
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowRight');
    press('ArrowRight');
    expect(focusedTitle()).toBe('P1 23');
    press('ArrowRight');
    expect(focusedTitle()).toBe('P1 25');
  });

  it('sur les logos, Haut / Bas ne font pas défiler la grille vers la gauche', () => {
    renderGuide();
    act(() => (document.querySelector('[data-guide-row="0"][data-guide-channel]') as HTMLElement).focus());
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    press('ArrowDown');
    expect(focusedTitle()).toBe('Chaîne 2');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('autre catégorie : on repart du programme en cours, pas de l\'heure suivie avant', () => {
    const { rerender, props } = renderGuide();
    act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
    press('ArrowRight'); // heure suivie : 21 h
    // La catégorie se choisit dans la barre : la sélection quitte le guide
    const bar = document.createElement('button');
    document.body.appendChild(bar);
    act(() => bar.focus());
    rerender(<GuideTvGrid {...props} isLoading />);
    rerender(<GuideTvGrid {...props} programs={basePrograms()} />);
    bar.remove();
    const entries = document.querySelectorAll('[data-guide-row][tabindex="0"]');
    expect(entries).toHaveLength(1);
    expect(entries[0].textContent).toContain('P1 20');
    act(() => (entries[0] as HTMLElement).focus());
    press('ArrowDown');
    expect(focusedTitle()).toBe('P2 19');
  });

  // La synchro des programmes recharge le guide (écran de chargement puis nouvelle grille) ;
  // la case sélectionnée disparaissait et plus rien n'avait le focus jusqu'à la flèche suivante.
  describe('rechargement du guide pendant la navigation', () => {
    const resync = (view: ReturnType<typeof renderGuide>, programs = basePrograms()) => {
      view.rerender(<GuideTvGrid {...view.props} isLoading />);
      view.rerender(<GuideTvGrid {...view.props} programs={programs} />);
    };
    /** Case sélectionnée, rien si le focus est perdu (sur la page) */
    const selected = () => (document.activeElement === document.body ? null : focusedTitle());

    it('la sélection reste sur le même programme, et la case est la seule sur le parcours', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      press('ArrowRight');
      press('ArrowDown');
      expect(focusedTitle()).toBe('P2 20.5');
      resync(view);
      expect(selected()).toBe('P2 20.5');
      const entries = document.querySelectorAll('[data-guide-row][tabindex="0"]');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toBe(document.activeElement);
      // L'heure suivie avant le rechargement (21 h) l'est encore
      press('ArrowUp');
      expect(focusedTitle()).toBe('P1 21');
    });

    it('programme remplacé par la synchro : celui de la même chaîne qui couvre la même heure', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      press('ArrowDown');
      expect(focusedTitle()).toBe('P2 19');
      const programs = basePrograms();
      programs.set('c2', [prog(2, 18.5, 20), prog(2, 20, 22)]);
      resync(view, programs);
      expect(selected()).toBe('P2 18.5');
    });

    it('sur un logo, la sélection reste sur le logo', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row="2"][data-guide-channel]') as HTMLElement).focus());
      resync(view);
      expect(selected()).toBe('Chaîne 3');
    });

    it('chaîne disparue au rechargement : la sélection reste dans le guide, sur la première chaîne', () => {
      const view = renderGuide();
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      press('ArrowDown');
      press('ArrowDown');
      expect(selected()).toBe('Chaîne 3');
      const fewer = channels.slice(0, 2);
      view.rerender(<GuideTvGrid {...view.props} channels={fewer} isLoading />);
      view.rerender(<GuideTvGrid {...view.props} channels={fewer} />);
      expect(selected()).toBe('P1 20');
    });

    it('sélection déplacée pendant le chargement : le rechargement ne la reprend pas', () => {
      const view = renderGuide();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      view.rerender(<GuideTvGrid {...view.props} isLoading />);
      act(() => outside.focus());
      view.rerender(<GuideTvGrid {...view.props} programs={basePrograms()} />);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('sélection partie hors du guide (barre des catégories) : le rechargement ne la reprend pas', () => {
      const view = renderGuide();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      act(() => (document.querySelector('[data-guide-row][tabindex="0"]') as HTMLElement).focus());
      act(() => outside.focus());
      resync(view);
      expect(document.activeElement).toBe(outside);
      outside.remove();
    });
  });

  it('hors TV, rien ne change : pas de case sur le parcours', () => {
    uninstall();
    uninstall = () => {};
    setTvMode(false);
    renderGuide();
    expect(document.querySelectorAll('[data-guide-row][tabindex]')).toHaveLength(0);
    expect(screen.getByTestId('guide-body').hasAttribute('data-nav-grid')).toBe(false);
  });
});
