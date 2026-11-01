/**
 * usePlayerRemote.ts — Télécommande dans le lecteur (Android TV).
 *
 * Sans souris, les contrôles ne s'affichaient jamais et les flèches déplaçaient le focus sur la
 * page cachée derrière la vidéo. Règles :
 *
 * Contrôles masqués
 * - OK, Haut, Bas : affichent les contrôles, focus sur Lecture/Pause (sur « Chaînes TV » en direct)
 * - Gauche / Droite : recul / avance de 10 s, contrôles affichés, focus sur la barre de progression
 * - Direct : jamais de changement de chaîne par les flèches (des zaps partaient en
 *   voulant naviguer) ; on change de chaîne par le menu « Chaînes TV » ou les touches Chaîne + / −
 * Contrôles affichés
 * - la navigation habituelle parcourt les boutons, chaque touche repousse le masquage
 * - barre de progression focusée : Gauche / Droite reculent / avancent, OK met en pause
 * - Retour masque les contrôles (PlayerControls), un second Retour quitte le lecteur
 * - Fenêtres (vitesse, pistes et sous-titres, statistiques) : le focus y entre à l'ouverture, sur le
 *   choix en cours, et revient sur leur bouton à la fermeture
 * Toujours : touches média (lecture/pause, avance/recul rapide, chaîne +/-)
 *
 * Écoute en capture sur window : passe avant la navigation spatiale (document). Les raccourcis
 * clavier du bureau (usePlayerKeyboard) sont désactivés sur TV.
 */

import { useEffect, useRef, type RefObject } from 'react';
import { isKeyRepeat, REPEAT_MOVE_INTERVAL_MS } from '../utils/spatialNavigation';

export const REMOTE_SEEK_SECONDS = 10;

type Direction = 'up' | 'down' | 'left' | 'right';

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

type FocusTarget = 'primary' | 'progress';

export type RemoteSwitcher = 'channels' | 'episodes' | null;

export type RemoteMenu = 'speed' | 'audio' | 'stats' | null;

export interface PlayerRemoteOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  progressRef: RefObject<HTMLElement | null>;
  controlsVisible: boolean;
  isLocked: boolean;
  isPaused: boolean;
  /** Direct : pas de déplacement dans le temps */
  isLive: boolean;
  /** Fenêtre qui attend une réponse (épisode suivant, erreur de lecture) : les flèches la parcourent */
  dialogOpen: boolean;
  /** Liste ouverte par-dessus la vidéo */
  switcher: RemoteSwitcher;
  /** Fenêtre ouverte depuis un bouton des contrôles */
  menu?: RemoteMenu;
  /** Affiche les contrôles et relance leur masquage automatique */
  showControls: () => void;
  togglePlayPause: () => void | Promise<void>;
  skip: (seconds: number) => void | Promise<void>;
  /** Direct : chaîne voisine dans la catégorie en cours (+1 suivante, -1 précédente), touches Chaîne + / − */
  zap?: (delta: number) => void;
}

const PRIMARY_SELECTOR = {
  live: '.player-controls-center .episode-trigger-btn',
  vod: '.player-controls-left .player-btn',
};

const DIALOG_SELECTOR = '.binge-popup-play, .playback-error button';

/** Première cible à l'ouverture d'une liste : l'élément en cours, sinon le premier */
const SWITCHER_SELECTORS: Record<'channels' | 'episodes', string[]> = {
  channels: ['.channel-switcher__grid [role="button"]'],
  episodes: ['.episode-switcher-list .is-active', '.episode-switcher-list [role="button"]'],
};

/** Cible à l'ouverture d'une fenêtre (le choix en cours, sinon le premier), et son bouton */
const MENU_SELECTORS: Record<'speed' | 'audio' | 'stats', { entry: string[]; trigger: string }> = {
  speed: {
    entry: ['.player-speed-menu .speed-item.active', '.player-speed-menu [role="button"]'],
    trigger: '.player-speed-container > button',
  },
  audio: {
    entry: ['.player-audio-sub-popup .popup-item.active', '.player-audio-sub-popup [role="button"]'],
    trigger: '.player-audio-sub-container > button',
  },
  stats: {
    entry: ['.geek-stats-close'],
    trigger: '.geek-stats-btn',
  },
};

/** Durée du glissement d'ouverture des listes (EpisodeSwitcher.css, ChannelSwitcher.css) */
const SWITCHER_SLIDE_MS = 350;

export function usePlayerRemote(options: PlayerRemoteOptions): void {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const pendingFocus = useRef<FocusTarget | null>(null);
  const { enabled, controlsVisible, dialogOpen, switcher, menu = null } = options;

  useEffect(() => {
    if (!enabled) return;
    let lastRepeat = 0;

    /** Touche maintenue : une action au plus toutes les REPEAT_MOVE_INTERVAL_MS */
    const allowRepeat = (event: KeyboardEvent) => {
      const now = Date.now();
      if (isKeyRepeat(event) && now - lastRepeat < REPEAT_MOVE_INTERVAL_MS) return false;
      lastRepeat = now;
      return true;
    };

    const reveal = (target: FocusTarget) => {
      pendingFocus.current = target;
      optionsRef.current.showControls();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const o = optionsRef.current;
      const key = event.key;
      const consume = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      // ---- Touches média, dans tous les états ----
      if (key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause') {
        consume();
        const wanted = key === 'MediaPlayPause' || (key === 'MediaPlay') === o.isPaused;
        if (!isKeyRepeat(event) && wanted) void o.togglePlayPause();
        o.showControls();
        return;
      }
      if (key === 'MediaFastForward' || key === 'MediaRewind') {
        consume();
        if (!o.isLive && allowRepeat(event)) {
          void o.skip(key === 'MediaFastForward' ? REMOTE_SEEK_SECONDS : -REMOTE_SEEK_SECONDS);
          o.showControls();
        }
        return;
      }
      if (key === 'ChannelUp' || key === 'ChannelDown') {
        consume();
        if (!isKeyRepeat(event) && o.zap) {
          o.zap(key === 'ChannelUp' ? 1 : -1);
          o.showControls();
        }
        return;
      }

      const direction = ARROWS[key];
      const ok = key === 'Enter';
      if (!direction && !ok) return;
      if (o.dialogOpen) return;

      if (o.isLocked) {
        consume();
        if (!isKeyRepeat(event)) o.showControls();
        return;
      }

      // ---- Contrôles masqués : la télécommande pilote la lecture ----
      if (!o.controlsVisible) {
        consume();
        if ((direction === 'left' || direction === 'right') && !o.isLive) {
          if (allowRepeat(event)) {
            void o.skip(direction === 'right' ? REMOTE_SEEK_SECONDS : -REMOTE_SEEK_SECONDS);
            reveal('progress');
          }
          return;
        }
        if (!isKeyRepeat(event)) reveal('primary');
        return;
      }

      // ---- Contrôles affichés : la navigation spatiale parcourt les boutons ----
      o.showControls();
      const active = document.activeElement;

      if (active && active === o.progressRef.current && !o.isLive) {
        if (direction === 'left' || direction === 'right') {
          consume();
          if (allowRepeat(event)) void o.skip(direction === 'right' ? REMOTE_SEEK_SECONDS : -REMOTE_SEEK_SECONDS);
          return;
        }
        if (ok) {
          consume();
          if (!isKeyRepeat(event)) void o.togglePlayPause();
          return;
        }
      }

      // Contrôles affichés à la souris (mode TV sous Windows), focus resté ailleurs : on le ramène
      if (!o.containerRef.current?.contains(active)) {
        consume();
        focusControl(o, 'primary');
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);

  // Contrôles affichés par la télécommande : focus sur la cible demandée. Masqués : le focus ne
  // reste pas sur un bouton invisible.
  useEffect(() => {
    if (!enabled) return;
    if (controlsVisible) {
      const target = pendingFocus.current;
      pendingFocus.current = null;
      if (!target) return;
      const frame = requestAnimationFrame(() => focusControl(optionsRef.current, target));
      return () => cancelAnimationFrame(frame);
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.player-controls-layer')) active.blur();
  }, [enabled, controlsVisible]);

  // Épisode suivant, erreur de lecture : focus sur l'action principale de la fenêtre
  useEffect(() => {
    if (!enabled || !dialogOpen) return;
    const frame = requestAnimationFrame(() => {
      optionsRef.current.containerRef.current?.querySelector<HTMLElement>(DIALOG_SELECTOR)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, dialogOpen]);

  // Liste de chaînes ou d'épisodes : focus dedans à l'ouverture, retour sur son bouton à la fermeture
  const openedSwitcher = useRef<RemoteSwitcher>(null);
  useEffect(() => {
    if (!enabled) return;
    const container = optionsRef.current.containerRef.current;
    if (switcher) {
      openedSwitcher.current = switcher;
      const timer = setTimeout(() => {
        const target = SWITCHER_SELECTORS[switcher]
          .map((selector) => container?.querySelector<HTMLElement>(selector))
          .find(Boolean);
        target?.focus({ preventScroll: false });
      }, SWITCHER_SLIDE_MS);
      return () => clearTimeout(timer);
    }
    if (openedSwitcher.current) {
      openedSwitcher.current = null;
      if (focusLost(container)) {
        container?.querySelector<HTMLElement>('.episode-trigger-btn')?.focus({ preventScroll: true });
      }
    }
  }, [enabled, switcher]);

  // Vitesse, pistes et sous-titres, statistiques : focus dedans à l'ouverture (sans quoi aucun choix
  // n'était atteignable, Chromecast), retour sur son bouton à la fermeture
  const openedMenu = useRef<RemoteMenu>(null);
  useEffect(() => {
    if (!enabled) return;
    const container = optionsRef.current.containerRef.current;
    const previous = openedMenu.current;
    openedMenu.current = menu;
    // Fenêtre fermée par l'arrivée d'une autre (épisode suivant, erreur) : c'est elle qui prend le focus
    if (previous && previous !== menu && !optionsRef.current.dialogOpen && focusLost(container)) {
      container?.querySelector<HTMLElement>(MENU_SELECTORS[previous].trigger)?.focus({ preventScroll: true });
    }
    if (!menu) return;
    const frame = requestAnimationFrame(() => {
      const target = MENU_SELECTORS[menu].entry
        .map((selector) => container?.querySelector<HTMLElement>(selector))
        .find(Boolean);
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, menu]);
}

function focusControl(o: PlayerRemoteOptions, target: FocusTarget): void {
  const container = o.containerRef.current;
  const element = target === 'progress' && !o.isLive
    ? o.progressRef.current
    : container?.querySelector<HTMLElement>(o.isLive ? PRIMARY_SELECTOR.live : PRIMARY_SELECTOR.vod)
      ?? container?.querySelector<HTMLElement>(PRIMARY_SELECTOR.vod);
  element?.focus({ preventScroll: true });
}

/** Focus perdu : sur la page, hors du lecteur, sur un élément disparu ou dans un panneau fermé */
function focusLost(container: HTMLElement | null): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !container?.contains(active) || !isShown(active)
    || active.closest('[inert]') !== null;
}

function isShown(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
}
