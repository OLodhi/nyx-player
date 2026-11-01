/**
 * Types du contexte Player : état exposé, actions et dernière demande de lecture.
 * Les types des contenus jouables (PlayableItem, DirectPlayableItem, PlayOptions) sont dans types/player.ts.
 */

import type { AppSeriesInfo } from '../../types/xtream';
import type { PlaybackError } from '../../services/player/playbackErrors';
import type { PlayableItem, DirectPlayableItem, PlayOptions } from '../../types/player';

/**
 * État du contexte Player
 */
export interface PlayerState {
    /** Item en cours de lecture (null = rien) */
    currentlyPlaying: PlayableItem | null;
    /** MPV connecté et prêt */
    mpvConnected: boolean;
    /** Transition vers le player en cours */
    isTransitioningToPlayer: boolean;
    /** Série en cours (pour navigation épisodes) */
    currentSeries: AppSeriesInfo | null;
    /** Échec du flux en cours (limite de connexions, accès refusé, format…), null si tout va bien */
    playbackError: PlaybackError | null;
    /**
     * Relances déjà effectuées pour la lecture en cours. Remis à zéro par une nouvelle lecture
     * ou quand la lecture a vraiment repris (confirmPlaybackRecovered).
     */
    retryAttempt: number;
}

/**
 * Actions du contexte Player
 */
export interface PlayerActions {
    /** Lancer la lecture d'un item. startPosition en secondes pour "Reprendre la lecture" */
    play: (item: PlayableItem | DirectPlayableItem, series?: AppSeriesInfo, startPosition?: number, options?: PlayOptions) => Promise<void>;
    /** Arrêter la lecture */
    stop: () => Promise<void>;
    /** Changer de chaîne à chaud (live TV — pas de transition ni progression) */
    switchChannel: (item: PlayableItem) => Promise<void>;
    /** Épisode suivant */
    playNextEpisode: () => Promise<void>;
    /** Épisode précédent */
    playPreviousEpisode: () => Promise<void>;
    /** Set current series for episode navigation (used by SeriesDetailPage) */
    setCurrentSeries: (series: AppSeriesInfo | null) => void;
    /** Relance le dernier flux demandé (même item, même position de départ) */
    retryPlayback: () => Promise<void>;
    /** Ferme le message sans arrêter la lecture (« Continuer quand même », appareil trop lent) */
    dismissPlaybackError: () => void;
    /** La vidéo défile de nouveau après une relance (usePlaybackRecovery) : compteur de relances à zéro */
    confirmPlaybackRecovered: () => void;
    /** Ferme le message d'un lancement qui n'a pas abouti (aucun lecteur ouvert) et abandonne la demande */
    cancelFailedLaunch: () => void;
}

/** Dernière demande de lecture, rejouée par retryPlayback */
export type LastPlayRequest =
    | { type: 'play'; item: PlayableItem | DirectPlayableItem; series?: AppSeriesInfo; startPosition?: number; options?: PlayOptions }
    | { type: 'switch'; item: PlayableItem };

export type PlayerContextValue = PlayerState & PlayerActions;
