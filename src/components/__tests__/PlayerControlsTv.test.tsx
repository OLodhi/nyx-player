/**
 * Lecteur à la télécommande (PlayerControls en mode TV).
 *
 * Le composant réel est monté avec ses vrais hooks (télécommande, masquage, actions, retour, menus,
 * fenêtres « épisode suivant » et erreur). Seuls le moteur de lecture, le contexte de lecture et les
 * services qui liraient la base ou le réseau sont imités : aucun flux réel, aucun fournisseur.
 *
 * Règles vérifiées (lecteur à la télécommande) :
 * - chaque bouton est rendu, atteignable au focus et déclenche la bonne action ;
 * - contrôles masqués : OK / Haut / Bas les affichent, Gauche / Droite reculent / avancent de 10 s ;
 * - direct : jamais de changement de chaîne avec Haut / Bas, seulement Chaîne + / − ;
 * - le focus entre dans les menus et fenêtres à l'ouverture et revient sur leur bouton ;
 * - Retour : menu ouvert, puis contrôles, puis sortie du lecteur ;
 * - le curseur de volume replié ne prend jamais le focus ; mêmes boutons sur téléphone et Windows.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import type { SeriesMetadata } from '../../types/player';
import type { LiveTvData } from '../../hooks/useChannelSwitcher';
import type { IptvStream } from '../../types/iptv';
import type { AppSeriesInfo } from '../../types/xtream';
import type { PlaybackError } from '../../services/player/playbackErrors';

type PropertyEvent = { name: string; data?: unknown };

const { fakeMpv, mpvStop, player, prefs } = vi.hoisted(() => {
  const state: Record<string, unknown> = { pause: false, mute: false, volume: 100 };
  const listeners = new Set<(e: PropertyEvent) => void>();
  return {
    mpvStop: vi.fn(),
    fakeMpv: {
      state,
      listeners,
      emit: (name: string, data: unknown) => listeners.forEach((cb) => cb({ name, data })),
      setProperty: vi.fn(async (name: string, value: unknown) => {
        state[name] = value;
        listeners.forEach((cb) => cb({ name, data: value }));
      }),
      getProperty: vi.fn(async (name: string) => (name in state ? state[name] : null)),
      observeProperties: vi.fn(async (_props: string[], cb: (e: PropertyEvent) => void) => {
        listeners.add(cb);
        return () => { listeners.delete(cb); };
      }),
      command: vi.fn(async () => undefined),
    },
    player: {
      switchChannel: vi.fn(),
      currentSeries: null as unknown,
      currentlyPlaying: null as unknown,
      play: vi.fn(),
      playbackError: null as unknown,
      retryAttempt: 0,
      retryPlayback: vi.fn(),
      dismissPlaybackError: vi.fn(),
      confirmPlaybackRecovered: vi.fn(),
    },
    prefs: { geekStats: true, binge: true },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key) }),
}));
vi.mock('../../contexts/PlayerContext', () => ({ usePlayer: () => player }));
const devOverrides = { overrides: { playerControls: {} }, setActivePage: () => {} };
vi.mock('../../contexts/DevOverrideContext', () => ({ useDevOverrides: () => devOverrides }));
vi.mock('../../services/player/mpvApi', () => ({
  setProperty: fakeMpv.setProperty,
  getProperty: fakeMpv.getProperty,
  observeProperties: fakeMpv.observeProperties,
  command: fakeMpv.command,
  setVideoMarginRatio: vi.fn(async () => undefined),
  listenMediaCommands: vi.fn(async () => () => {}),
}));
vi.mock('../../services/mpvBridge', () => ({ mpvStop, getLoadSequence: () => 0 }));
vi.mock('../../services/player/androidPlayer', () => ({ setFullscreen: vi.fn(), observeProperties: vi.fn() }));
vi.mock('../../services/preferencesService', () => ({
  isGeekStatsEnabled: () => prefs.geekStats,
  isBingeModeEnabled: () => prefs.binge,
  getBingeCountdown: () => 10,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onResized: () => Promise.resolve(() => {}),
    isFullscreen: () => Promise.resolve(false),
    setFullscreen: () => Promise.resolve(),
    innerSize: () => Promise.resolve({ width: 1280, height: 720 }),
  }),
}));
// Hors sujet ici (base locale, guide TV, TMDB) : neutralisés
const noPrefs = {
  savePlaybackPosition: () => Promise.resolve(),
  audioTracks: [{ id: 1, type: 'audio', title: 'Français', lang: 'fre' }, { id: 2, type: 'audio', title: 'English', lang: 'eng' }],
  subTracks: [],
  subtitleScale: 1,
  changeSpeed: vi.fn(),
  selectAudioTrack: vi.fn(),
  selectSubTrack: vi.fn(),
  changeSubtitleScale: vi.fn(),
};
vi.mock('../../hooks/usePlayerPreferences', () => ({ usePlayerPreferences: () => noPrefs }));
vi.mock('../../hooks/usePeriodicSave', () => ({ usePeriodicSave: () => {} }));
vi.mock('../../hooks/usePlayerEpg', () => ({ usePlayerEpg: () => ({ nowProgram: null, nextProgram: null, isVisible: false }) }));
vi.mock('../../hooks/useStallWatchdog', () => ({ useStallWatchdog: () => {}, useLiveEndWatchdog: () => {} }));
vi.mock('../../hooks/usePlaybackRecovery', () => ({ usePlaybackRecovery: () => {} }));
vi.mock('../../hooks/useMediaCommands', () => ({ useMediaCommands: () => {} }));
vi.mock('../../hooks/useTmdbSeries', () => ({ useTmdbSeries: () => ({ currentSeasonEpisodes: [], isSeasonLoading: false }) }));
vi.mock('../../services/memoryService', () => ({ requestMemoryPurge: () => {} }));
vi.mock('../../services/tmdbApi', () => ({ default: { imageUrl: () => null } }));
vi.mock('../Player/EpgBanner', () => ({ default: () => null }));
// Liste des chaînes : réduite à sa grille (ses propres tests couvrent le reste)
vi.mock('../Tv/ChannelSwitcher', () => ({
  default: ({ isOpen, filteredChannels, onChannelClick }: { isOpen: boolean; filteredChannels: IptvStream[]; onChannelClick: (c: IptvStream) => void }) => (
    <div className="channel-switcher" {...(isOpen ? {} : { inert: '' })}>
      <div className="channel-switcher__grid">
        {filteredChannels.map((c) => (
          <div key={c.stream_id} role="button" tabIndex={0} onClick={() => onChannelClick(c)}>{c.name}</div>
        ))}
      </div>
    </div>
  ),
}));

import PlayerControls from '../PlayerControls';
import { setTvMode } from '../../utils/platform';
import { dispatchBack } from '../../hooks/useBackHandler';

// ---------------------------------------------------------------------------
// Données factices
// ---------------------------------------------------------------------------

const channel = (id: number): IptvStream => ({
  num: id, name: `Chaîne ${id}`, stream_type: 'live', stream_id: id, stream_icon: '', added: '', category_id: 'c1', tmdb: 0,
});
const CHANNELS = [channel(1), channel(2), channel(3)];
const liveTvData: LiveTvData = {
  categories: [{ category_id: 'c1', category_name: 'Généralistes', parent_id: 0 }],
  streams: CHANNELS,
  currentChannel: CHANNELS[1],
  currentCategoryId: 'c1',
  favorites: new Set(),
  pinnedCategories: new Set(),
  togglePin: () => {},
  totalChannels: 3,
};

const episode = (id: string, num: number) => ({ id, episode_num: num, title: `Épisode ${num}`, container_extension: 'mkv' });
const SERIES = { series_id: 5, name: 'Série test', episodes: { '1': [episode('11', 1), episode('12', 2)] } } as unknown as AppSeriesInfo;
const seriesMetadata: SeriesMetadata = {
  seriesId: 5, seriesName: 'Série test', seasonNumber: 1, episodeNumber: 1, episodeTitle: 'Pilote',
  episodeId: '11', containerExtension: 'mkv',
  nextEpisode: { episodeId: '12', seasonNumber: 1, episodeNumber: 2, episodeTitle: 'La suite' },
};

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

/** Touche de télécommande, envoyée là où est le focus (comme sur l'appareil) */
function press(key: string) {
  const target = document.activeElement ?? document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { target.dispatchEvent(event); });
  return event;
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T & HTMLElement>(selector);
const byTitle = (title: string) => $(`[title="${title}"]`)!;
const playPause = () => $('.player-controls-left .player-btn')!;
const controlsShown = () => $('.player-controls-layer')!.classList.contains('visible');
const focused = () => document.activeElement;

type Props = Partial<React.ComponentProps<typeof PlayerControls>>;

async function mountPlayer(props: Props = {}) {
  const onClose = vi.fn();
  const view = render(<PlayerControls title="Film test" isConnected onClose={onClose} {...props} />);
  await flush();
  const rerender = async (next: Props = {}) => {
    view.rerender(<PlayerControls title="Film test" isConnected onClose={onClose} {...props} {...next} />);
    await flush();
  };
  return { ...view, onClose, rerender };
}

/** Attend le masquage automatique (5 s sans touche en mode TV) */
async function hideControls() {
  advance(5000);
  expect(controlsShown()).toBe(false);
}

// jsdom ne défile pas : la liste des épisodes appelle scrollIntoView à l'ouverture
const originalScrollIntoView = Element.prototype.scrollIntoView;
beforeAll(() => { Element.prototype.scrollIntoView = () => {}; });
afterAll(() => { Element.prototype.scrollIntoView = originalScrollIntoView; });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  setTvMode(true);
  prefs.geekStats = true;
  prefs.binge = true;
  Object.assign(fakeMpv.state, { pause: false, mute: false, volume: 100 });
  fakeMpv.listeners.clear();
  fakeMpv.setProperty.mockClear();
  fakeMpv.command.mockClear();
  mpvStop.mockReset().mockResolvedValue(undefined);
  Object.assign(player, {
    currentSeries: null, currentlyPlaying: null, playbackError: null, retryAttempt: 0,
  });
  player.switchChannel.mockReset();
  player.play.mockReset().mockResolvedValue(undefined);
  player.retryPlayback.mockReset();
  player.dismissPlaybackError.mockReset();
  player.confirmPlaybackRecovered.mockReset();
  for (const fn of [noPrefs.changeSpeed, noPrefs.selectAudioTrack, noPrefs.selectSubTrack, noPrefs.changeSubtitleScale]) fn.mockReset();
});

afterEach(() => {
  setTvMode(false);
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Lecteur TV : boutons', () => {
  it('film : tous les boutons sont rendus et atteignables au focus', async () => {
    await mountPlayer();
    const buttons = [
      playPause(), byTitle('rewind_10s'), byTitle('forward_10s'), byTitle('playback_speed'),
      byTitle('audio_subs_menu'), byTitle('geek_stats'), byTitle('aspect_fit'), $('.player-close-btn')!,
    ];
    // Le verrou (tactile) est masqué sur TV par tv.css : vérifié dans « Même lecteur sur téléphone et Windows »
    for (const button of buttons) {
      expect(button).toBeInTheDocument();
      button.focus();
      expect(focused()).toBe(button);
    }
    // Barre de progression atteignable et annoncée comme curseur
    const progress = $('.player-progress-container')!;
    expect(progress).toHaveAttribute('tabindex', '0');
    expect(progress).toHaveAttribute('role', 'slider');
  });

  it('série : boutons épisode précédent, suivant et liste des épisodes', async () => {
    player.currentSeries = SERIES;
    await mountPlayer({ seriesMetadata, onNextEpisode: vi.fn(), onPrevEpisode: vi.fn() });
    expect(byTitle('prev_episode')).toBeInTheDocument();
    expect(byTitle('next_episode')).toBeInTheDocument();
    expect(byTitle('Épisodes')).toBeInTheDocument();
    expect($('.player-title')).toHaveTextContent('Série test');
  });

  it('statistiques désactivées dans les réglages : pas de bouton', async () => {
    prefs.geekStats = false;
    await mountPlayer();
    expect($('.geek-stats-btn')).toBeNull();
  });

  it('chaque bouton déclenche la bonne action du moteur', async () => {
    const { onClose } = await mountPlayer();

    fireEvent.click(playPause());
    await flush();
    expect(fakeMpv.setProperty).toHaveBeenCalledWith('pause', true);

    fireEvent.click(byTitle('rewind_10s'));
    fireEvent.click(byTitle('forward_10s'));
    await flush();
    expect(fakeMpv.command).toHaveBeenCalledWith('seek', ['-10', 'relative']);
    expect(fakeMpv.command).toHaveBeenCalledWith('seek', ['10', 'relative']);

    fireEvent.click($('.player-volume-container .player-btn')!);
    await flush();
    expect(fakeMpv.setProperty).toHaveBeenCalledWith('mute', true);

    fireEvent.click(byTitle('aspect_fit'));
    await flush();
    expect(fakeMpv.setProperty).toHaveBeenCalledWith('panscan', 1);
    expect(byTitle('aspect_fill')).toBeInTheDocument();

    fireEvent.click($('.player-close-btn')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(mpvStop).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('épisode suivant / précédent : lancés par leurs boutons', async () => {
    const onNextEpisode = vi.fn();
    const onPrevEpisode = vi.fn();
    await mountPlayer({ seriesMetadata, onNextEpisode, onPrevEpisode });
    fireEvent.click(byTitle('next_episode'));
    await flush();
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
    fireEvent.click(byTitle('prev_episode'));
    await flush();
    expect(onPrevEpisode).toHaveBeenCalledTimes(1);
  });

  it('curseur de volume replié : jamais atteignable par la télécommande', async () => {
    await mountPlayer();
    expect($('.volume-slider-input')).toHaveAttribute('tabindex', '-1');
  });
});

describe('Lecteur TV : contrôles masqués', () => {
  it('masqués après 5 s sans touche, et le focus quitte le bouton invisible', async () => {
    await mountPlayer();
    playPause().focus();
    advance(4999);
    expect(controlsShown()).toBe(true);
    advance(1);
    expect(controlsShown()).toBe(false);
    expect(focused()).not.toBe(playPause());
  });

  it.each(['Enter', 'ArrowUp', 'ArrowDown'])('%s : affiche les contrôles, focus sur Lecture/Pause, sans mettre en pause', async (key) => {
    await mountPlayer();
    await hideControls();
    const event = press(key);
    advance(16);
    expect(event.defaultPrevented).toBe(true);
    expect(controlsShown()).toBe(true);
    expect(focused()).toBe(playPause());
    expect(fakeMpv.setProperty).not.toHaveBeenCalledWith('pause', expect.anything());
  });

  it('Gauche / Droite : recul / avance de 10 s, focus sur la barre de progression', async () => {
    await mountPlayer();
    await hideControls();
    press('ArrowRight');
    advance(16);
    await flush();
    expect(fakeMpv.command).toHaveBeenLastCalledWith('seek', ['10', 'relative']);
    expect(controlsShown()).toBe(true);
    expect(focused()).toBe($('.player-progress-container'));

    // Contrôles affichés, barre focusée : Gauche recule, OK met en pause
    advance(300);
    press('ArrowLeft');
    await flush();
    expect(fakeMpv.command).toHaveBeenLastCalledWith('seek', ['-10', 'relative']);
    press('Enter');
    await flush();
    expect(fakeMpv.setProperty).toHaveBeenCalledWith('pause', true);
  });

  it('chaque touche repousse le masquage', async () => {
    await mountPlayer();
    playPause().focus();
    advance(4000);
    press('ArrowRight');
    advance(4000);
    expect(controlsShown()).toBe(true);
    advance(1000);
    expect(controlsShown()).toBe(false);
  });

  // Verrou invisible sur l'appareil TV (tv.css) : filet de sécurité pour le mode TV sous Windows, à la souris
  it('filet de sécurité : verrou actif en mode TV, les flèches ne font qu\'afficher le cadenas', async () => {
    await mountPlayer();
    fireEvent.click(byTitle('lock'));
    expect(byTitle('unlock')).toBeInTheDocument();
    fakeMpv.command.mockClear();
    const event = press('ArrowRight');
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(fakeMpv.command).not.toHaveBeenCalled();
    expect($('.player-controls-layer')).toHaveClass('locked');
  });
});

describe('Lecteur TV : direct (pas de zap aux flèches)', () => {
  const live = { liveTvData, title: 'Chaîne 2' };

  it('contrôles masqués : Haut / Bas affichent les contrôles, focus sur « Chaînes TV », aucun zap', async () => {
    await mountPlayer(live);
    await hideControls();
    press('ArrowUp');
    advance(16);
    expect(controlsShown()).toBe(true);
    expect(focused()).toBe(byTitle('Chaînes TV'));
    await hideControls();
    press('ArrowDown');
    advance(16);
    expect(player.switchChannel).not.toHaveBeenCalled();
  });

  it('contrôles affichés : Haut / Bas ne changent jamais de chaîne', async () => {
    await mountPlayer(live);
    playPause().focus();
    for (let i = 0; i < 4; i++) {
      press('ArrowUp');
      press('ArrowDown');
      advance(250);
    }
    expect(player.switchChannel).not.toHaveBeenCalled();
  });

  it('Gauche / Droite masqués : pas de déplacement dans le temps en direct', async () => {
    await mountPlayer(live);
    await hideControls();
    press('ArrowRight');
    await hideControls();
    press('ArrowLeft');
    await flush();
    expect(fakeMpv.command).not.toHaveBeenCalled();
  });

  it('barre de progression inaccessible en direct', async () => {
    await mountPlayer(live);
    expect($('.player-progress-container')).not.toHaveAttribute('tabindex');
  });

  it('Chaîne + / − : chaîne voisine dans la catégorie, en boucle', async () => {
    await mountPlayer(live);
    press('ChannelUp');
    expect(player.switchChannel).toHaveBeenLastCalledWith(CHANNELS[2]);
    press('ChannelDown');
    expect(player.switchChannel).toHaveBeenLastCalledWith(CHANNELS[0]);
  });

  it('film : Chaîne + / − ne font rien', async () => {
    await mountPlayer();
    press('ChannelUp');
    expect(player.switchChannel).not.toHaveBeenCalled();
  });

  it('« Chaînes TV » : le focus entre dans la liste, Retour la ferme et rend le focus au bouton', async () => {
    await mountPlayer(live);
    const trigger = byTitle('Chaînes TV');
    trigger.focus();
    fireEvent.click(trigger);
    advance(350);
    expect(focused()).toBe($('.channel-switcher__grid [role="button"]'));

    act(() => { dispatchBack(); });
    await flush();
    expect(trigger).not.toHaveClass('active');
    expect(focused()).toBe(trigger);
  });
});

// jsdom ne calcule pas la taille des éléments : le focus y passe toujours pour « perdu » à la fermeture
// d'un menu. Le cas « focus resté sur un élément visible » se vérifie sur l'appareil.
describe('Lecteur TV : menus', () => {
  it('Vitesse : le focus va sur la vitesse en cours, Retour ferme et rend le focus au bouton', async () => {
    await mountPlayer();
    const trigger = $('.player-speed-container > button')!;
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);
    expect(focused()).toHaveClass('speed-item', 'active');

    act(() => { dispatchBack(); });
    advance(16);
    expect($('.player-speed-menu')).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('Pistes et sous-titres : le focus va sur la piste en cours, choisir une piste l\'applique', async () => {
    await mountPlayer();
    const trigger = $('.player-audio-sub-container > button')!;
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);
    expect(focused()).toHaveClass('popup-item', 'active');
    expect(focused()).toHaveTextContent('Français');

    fireEvent.click(Array.from(document.querySelectorAll('.popup-item')).find((el) => el.textContent?.includes('English'))!);
    expect(noPrefs.selectAudioTrack).toHaveBeenCalledWith(2);
  });

  it('Statistiques : focus sur la croix, la fermer rend le focus au bouton', async () => {
    await mountPlayer();
    const trigger = byTitle('geek_stats');
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);
    expect(focused()).toHaveClass('geek-stats-close');

    fireEvent.click(focused()!);
    advance(16);
    expect($('.geek-stats-overlay')).toBeNull();
    expect(focused()).toBe(trigger);
  });

  it('Retour : ferme le menu, puis masque les contrôles, puis quitte le lecteur', async () => {
    const { onClose } = await mountPlayer();
    const trigger = $('.player-speed-container > button')!;
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);

    act(() => { dispatchBack(); });
    expect($('.player-speed-menu')).toBeNull();
    expect(controlsShown()).toBe(true);

    act(() => { dispatchBack(); });
    expect(controlsShown()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();

    act(() => { dispatchBack(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('« Épisodes » : le focus entre sur l\'épisode en cours, en choisir un lance sa lecture', async () => {
    player.currentSeries = SERIES;
    player.currentlyPlaying = episode('12', 2);
    await mountPlayer({ seriesMetadata });
    const trigger = byTitle('Épisodes');
    trigger.focus();
    fireEvent.click(trigger);
    advance(350);
    const active = $('.episode-switcher-list .is-active')!;
    expect(focused()).toBe(active);

    press('Enter');
    await flush();
    expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ id: '12' }), SERIES, 0, expect.objectContaining({ seriesId: 5 }));
  });
});

describe('Lecteur TV : fenêtres qui attendent une réponse', () => {
  it('épisode suivant : focus sur « Lire maintenant », le menu vitesse ouvert se ferme', async () => {
    const onNextEpisode = vi.fn();
    await mountPlayer({ seriesMetadata, onNextEpisode });
    const trigger = $('.player-speed-container > button')!;
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);
    expect($('.player-speed-menu')).not.toBeNull();

    act(() => {
      fakeMpv.emit('duration', 100);
      fakeMpv.emit('time-pos', 95);
    });
    advance(16);
    expect($('.player-speed-menu')).toBeNull();
    expect(focused()).toHaveClass('binge-popup-play');

    // Les flèches parcourent la fenêtre : pas de saut dans le temps
    fakeMpv.command.mockClear();
    press('ArrowLeft');
    await flush();
    expect(fakeMpv.command).not.toHaveBeenCalled();

    fireEvent.click(focused()!);
    await flush();
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
  });

  it('épisode suivant, décompte à zéro : lancé automatiquement', async () => {
    const onNextEpisode = vi.fn();
    await mountPlayer({ seriesMetadata, onNextEpisode });
    act(() => {
      fakeMpv.emit('duration', 100);
      fakeMpv.emit('time-pos', 95);
    });
    expect($('.binge-popup')).not.toBeNull();
    advance(10_000);
    await flush();
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
    expect($('.binge-popup')).toBeNull();
  });

  it('dernier épisode : jamais de fenêtre « épisode suivant »', async () => {
    await mountPlayer({ seriesMetadata: { ...seriesMetadata, nextEpisode: undefined }, onNextEpisode: vi.fn() });
    act(() => {
      fakeMpv.emit('duration', 100);
      fakeMpv.emit('time-pos', 99);
    });
    expect($('.binge-popup')).toBeNull();
  });

  it('erreur de lecture : focus sur l\'action principale, menus fermés, indicateur de chargement retiré', async () => {
    const { rerender } = await mountPlayer();
    const trigger = $('.player-audio-sub-container > button')!;
    trigger.focus();
    fireEvent.click(trigger);
    advance(16);
    expect($('.player-audio-sub-popup')).not.toBeNull();

    player.playbackError = { kind: 'network' } satisfies PlaybackError;
    await rerender();
    advance(16);
    expect($('.player-audio-sub-popup')).toBeNull();
    expect($('.player-loading')).toBeNull();
    expect(focused()?.closest('.playback-error')).not.toBeNull();
    expect(focused()?.tagName).toBe('BUTTON');
  });
});

describe('Même lecteur sur téléphone et Windows', () => {
  it('mêmes boutons, curseur de volume atteignable, barre de progression sans focus télécommande', async () => {
    setTvMode(false);
    await mountPlayer();
    for (const title of ['rewind_10s', 'forward_10s', 'playback_speed', 'audio_subs_menu', 'geek_stats', 'aspect_fit', 'lock']) {
      expect(byTitle(title)).toBeInTheDocument();
    }
    expect(playPause()).toBeInTheDocument();
    expect($('.volume-slider-input')).not.toHaveAttribute('tabindex');
    expect($('.player-progress-container')).not.toHaveAttribute('role');
  });

  it('hors TV, les flèches restent les raccourcis clavier (volume), jamais la télécommande', async () => {
    setTvMode(false);
    await mountPlayer();
    advance(3000);
    press('ArrowDown');
    await flush();
    expect(fakeMpv.setProperty).toHaveBeenCalledWith('volume', 95);
    expect(fakeMpv.command).not.toHaveBeenCalled();
  });
});
