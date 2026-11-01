/**
 * Tests pour usePlayerRemote.ts — télécommande dans le lecteur (Android TV)
 *
 * Régression : sur TV, les contrôles ne s'affichaient jamais (aucune souris) et les flèches
 * déplaçaient le focus sur la page cachée derrière la vidéo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlayerRemote, REMOTE_SEEK_SECONDS, type PlayerRemoteOptions } from '../usePlayerRemote';
import { installSpatialNavigation } from '../../utils/spatialNavigation';

function setup(overrides: Partial<PlayerRemoteOptions> = {}) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="player-controls-layer">
      <div class="player-progress-container" tabindex="0"></div>
      <div class="player-controls-left"><button class="player-btn">play</button></div>
    </div>`;
  document.body.appendChild(container);
  const progress = container.querySelector<HTMLElement>('.player-progress-container')!;
  const options: PlayerRemoteOptions = {
    enabled: true,
    containerRef: { current: container },
    progressRef: { current: progress },
    controlsVisible: false,
    isLocked: false,
    isPaused: false,
    isLive: false,
    dialogOpen: false,
    switcher: null,
    showControls: vi.fn(),
    togglePlayPause: vi.fn(),
    skip: vi.fn(),
    zap: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((props: PlayerRemoteOptions) => usePlayerRemote(props), { initialProps: options });
  return { options, hook, container, progress };
}

function press(key: string, repeat = false, target: EventTarget = document.body) {
  const event = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('usePlayerRemote', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('contrôles masqués : Gauche / Droite reculent et avancent, et affichent les contrôles', () => {
    const { options } = setup();
    const left = press('ArrowLeft');
    press('ArrowRight');
    expect(options.skip).toHaveBeenNthCalledWith(1, -REMOTE_SEEK_SECONDS);
    expect(options.skip).toHaveBeenNthCalledWith(2, REMOTE_SEEK_SECONDS);
    expect(options.showControls).toHaveBeenCalledTimes(2);
    // La navigation spatiale (document) ne doit pas déplacer le focus derrière la vidéo
    expect(left.defaultPrevented).toBe(true);
  });

  it('contrôles masqués : OK affiche les contrôles sans mettre en pause', () => {
    const { options } = setup();
    press('Enter');
    expect(options.showControls).toHaveBeenCalledTimes(1);
    expect(options.togglePlayPause).not.toHaveBeenCalled();
  });

  it('flèche maintenue : un déplacement dans le temps au plus toutes les 200 ms', () => {
    vi.useFakeTimers();
    const { options } = setup();
    press('ArrowRight');
    press('ArrowRight', true);
    press('ArrowRight', true);
    expect(options.skip).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    press('ArrowRight', true);
    expect(options.skip).toHaveBeenCalledTimes(2);
  });

  // Android TV répète OK maintenu sans marquer les répétitions (repeat reste faux) ; la
  // navigation spatiale, posée au démarrage avant le lecteur, les reconnaît
  it('OK maintenu sur Android (répétitions non marquées) : une seule lecture/pause', () => {
    const uninstall = installSpatialNavigation();
    try {
      const { options, progress } = setup({ controlsVisible: true });
      progress.focus();
      for (let i = 0; i < 4; i += 1) press('Enter', false, progress);
      expect(options.togglePlayPause).toHaveBeenCalledTimes(1);
      progress.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      press('Enter', false, progress);
      expect(options.togglePlayPause).toHaveBeenCalledTimes(2);
    } finally {
      uninstall();
    }
  });

  it('OK maintenu sur Android, contrôles masqués : ils s\'affichent sans lecture/pause', () => {
    const uninstall = installSpatialNavigation();
    try {
      const { options, hook, container } = setup();
      press('Enter');
      expect(options.showControls).toHaveBeenCalledTimes(1);
      // Contrôles maintenant affichés, focus sur Lecture : la répétition n'active pas le bouton
      const button = container.querySelector<HTMLElement>('.player-btn')!;
      let clicks = 0;
      button.addEventListener('keydown', (e) => { if (e.key === 'Enter') clicks += 1; });
      hook.rerender({ ...options, controlsVisible: true });
      button.focus();
      expect(press('Enter', false, button).defaultPrevented).toBe(true);
      expect(clicks).toBe(0);
      expect(options.togglePlayPause).not.toHaveBeenCalled();
    } finally {
      uninstall();
    }
  });

  // Lecture/Pause, Chaîne + et flèches maintenues sur Android, répétitions non marquées
  it('touches maintenues sur Android (répétitions non marquées) : pas d\'action en boucle', () => {
    vi.useFakeTimers();
    const uninstall = installSpatialNavigation();
    try {
      const { options } = setup({ isLive: false });
      const hold = (k: string) => {
        press(k);
        for (let i = 0; i < 3; i += 1) {
          vi.advanceTimersByTime(50);
          press(k);
        }
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
      };
      hold('MediaPlayPause');
      expect(options.togglePlayPause).toHaveBeenCalledTimes(1);
      hold('ChannelUp');
      expect(options.zap).toHaveBeenCalledTimes(1);
      hold('ArrowRight'); // 150 ms tenue : un seul saut
      expect(options.skip).toHaveBeenCalledTimes(1);
    } finally {
      uninstall();
    }
  });

  it('direct : les flèches ne changent jamais de chaîne, elles affichent les contrôles', () => {
    const { options } = setup({ isLive: true });
    const down = press('ArrowDown');
    press('ArrowUp');
    press('ArrowLeft');
    expect(options.zap).not.toHaveBeenCalled();
    expect(options.skip).not.toHaveBeenCalled();
    expect(options.showControls).toHaveBeenCalledTimes(3);
    expect(down.defaultPrevented).toBe(true);
  });

  it('direct : Chaîne + / − changent toujours de chaîne', () => {
    const { options } = setup({ isLive: true });
    press('ChannelUp');
    press('ChannelDown');
    expect(options.zap).toHaveBeenNthCalledWith(1, 1);
    expect(options.zap).toHaveBeenNthCalledWith(2, -1);
  });

  it('contrôles affichés : sur la barre de progression, Gauche avance le temps au lieu du focus', () => {
    const { options, progress } = setup({ controlsVisible: true });
    progress.focus();
    const event = press('ArrowLeft', false, progress);
    expect(options.skip).toHaveBeenCalledWith(-REMOTE_SEEK_SECONDS);
    expect(event.defaultPrevented).toBe(true);
  });

  it('contrôles affichés : ailleurs, les flèches restent à la navigation spatiale', () => {
    const { options, container } = setup({ controlsVisible: true });
    const button = container.querySelector<HTMLElement>('.player-btn')!;
    button.focus();
    const event = press('ArrowRight', false, button);
    expect(options.skip).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(options.showControls).toHaveBeenCalled();
  });

  it('touches média : lecture/pause et avance rapide, quel que soit l\'état', () => {
    const { options } = setup({ controlsVisible: true });
    press('MediaPlayPause');
    press('MediaFastForward');
    press('MediaPlay'); // déjà en lecture : rien
    expect(options.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(options.skip).toHaveBeenCalledWith(REMOTE_SEEK_SECONDS);
  });

  it('fenêtre ouverte (épisode suivant, erreur) : les flèches la parcourent', () => {
    const { options } = setup({ dialogOpen: true });
    const event = press('ArrowRight');
    expect(options.skip).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('hors TV : aucune touche interceptée', () => {
    const { options } = setup({ enabled: false });
    press('ArrowLeft');
    press('Enter');
    expect(options.skip).not.toHaveBeenCalled();
    expect(options.showControls).not.toHaveBeenCalled();
  });
});

describe('usePlayerRemote : fenêtres du lecteur (Chromecast)', () => {
  const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  function menuSetup() {
    const context = setup({ controlsVisible: true });
    context.container.insertAdjacentHTML('beforeend', `
      <div class="player-speed-container">
        <button>1x</button>
        <div class="player-speed-menu">
          <div class="speed-item" role="button" tabindex="0">0.5x</div>
          <div class="speed-item active" role="button" tabindex="0">1x</div>
        </div>
      </div>
      <button class="player-btn geek-stats-btn">stats</button>
      <div class="geek-stats-overlay"><button class="geek-stats-close">x</button></div>`);
    return context;
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('vitesse : le focus entre dans la fenêtre à l\'ouverture, sur la vitesse en cours', async () => {
    const { hook, options, container } = menuSetup();
    hook.rerender({ ...options, menu: 'speed' });
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('.speed-item.active'));
  });

  it('vitesse : à la fermeture, le focus revient sur son bouton', async () => {
    const { hook, options, container } = menuSetup();
    hook.rerender({ ...options, menu: 'speed' });
    await nextFrame();
    // Choix fait : la fenêtre disparaît avec l'élément focusé
    container.querySelector('.player-speed-menu')!.remove();
    hook.rerender({ ...options, menu: null });
    expect(document.activeElement).toBe(container.querySelector('.player-speed-container > button'));
  });

  it('statistiques : focus sur Fermer à l\'ouverture, puis sur leur bouton à la fermeture', async () => {
    const { hook, options, container } = menuSetup();
    hook.rerender({ ...options, menu: 'stats' });
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('.geek-stats-close'));
    container.querySelector('.geek-stats-overlay')!.remove();
    hook.rerender({ ...options, menu: null });
    expect(document.activeElement).toBe(container.querySelector('.geek-stats-btn'));
  });

  it('hors TV : l\'ouverture d\'une fenêtre ne touche pas au focus', async () => {
    const { hook, options } = menuSetup();
    hook.rerender({ ...options, enabled: false, menu: 'speed' });
    await nextFrame();
    expect(document.activeElement).toBe(document.body);
  });

  it('pistes et sous-titres : focus sur la piste en cours à l\'ouverture', async () => {
    const { hook, options, container } = menuSetup();
    container.insertAdjacentHTML('beforeend', `
      <div class="player-audio-sub-container">
        <button>audio</button>
        <div class="player-audio-sub-popup">
          <div class="popup-item" role="button" tabindex="0">Français</div>
          <div class="popup-item active" role="button" tabindex="0">English</div>
        </div>
      </div>`);
    hook.rerender({ ...options, menu: 'audio' });
    await nextFrame();
    expect(document.activeElement).toBe(container.querySelector('.player-audio-sub-popup .popup-item.active'));
  });

  it('fenêtre fermée par l\'arrivée de l\'épisode suivant : le focus ne revient pas sur son bouton', async () => {
    const { hook, options, container } = menuSetup();
    hook.rerender({ ...options, menu: 'speed' });
    await nextFrame();
    container.querySelector('.player-speed-menu')!.remove();
    hook.rerender({ ...options, menu: null, dialogOpen: true });
    expect(document.activeElement).not.toBe(container.querySelector('.player-speed-container > button'));
  });
});

describe('usePlayerRemote : fermeture de la liste de chaînes (Chromecast)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focus resté sur une chaîne de la liste refermée (inert) : il revient sur « Chaînes TV »', () => {
    const context = setup({ controlsVisible: true, isLive: true });
    context.container.insertAdjacentHTML('beforeend', `
      <div class="player-controls-center"><button class="player-btn episode-trigger-btn">Chaînes TV</button></div>
      <div class="channel-switcher"><div class="channel-switcher__grid"><div role="button" tabindex="0" class="card">TF1</div></div></div>`);
    const card = context.container.querySelector<HTMLElement>('.card')!;
    // Carte encore affichée pendant le glissement de fermeture : jsdom ne calcule rien, on le simule
    card.getBoundingClientRect = () =>
      ({ left: -50, top: 100, right: 150, bottom: 200, width: 200, height: 100, x: -50, y: 100, toJSON: () => ({}) }) as DOMRect;
    context.hook.rerender({ ...context.options, switcher: 'channels' });
    card.focus();
    context.container.querySelector('.channel-switcher')!.setAttribute('inert', '');
    context.hook.rerender({ ...context.options, switcher: null });
    expect(document.activeElement).toBe(context.container.querySelector('.episode-trigger-btn'));
  });
});
