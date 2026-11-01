/**
 * PlayerContext - Gestion centralisée du lecteur MPV
 *
 * CONTEXTE:
 * Centralise l'état de lecture et les actions de contrôle du player :
 * - État de lecture (currentlyPlaying, mpvConnected)
 * - États de transition (isTransitioningToPlayer)
 * - Actions (play, stop, navigate episodes)
 *
 * Phase 3 Z6: play() splitté en sous-fonctions (buildStreamUrl, recordPlaybackStart).
 * Types PlayableItem/DirectPlayableItem/PlayOptions déplacés dans types/player.ts.
 *
 * Le contexte ne fait plus que réunir les morceaux de contexts/player/ :
 * - usePlaybackSession : lecture, arrêt, zap, relance, message d'erreur (état partagé)
 * - useMpvConnection : connexion au moteur
 * - usePlayerPageEffects : travaux de fond suspendus, classe player-active, fond de la fenêtre
 * - useEpisodeSkip : épisodes suivant et précédent
 * - streamRequest : adresse du flux, position de départ, début de lecture (sans React)
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { usePlaybackSession } from './player/usePlaybackSession';
import { useMpvConnection } from './player/useMpvConnection';
import { usePlayerPageEffects } from './player/usePlayerPageEffects';
import { useEpisodeSkip } from './player/useEpisodeSkip';
import type { PlayerContextValue } from './player/types';

// Re-export types from types/player.ts for backward compatibility
export type { PlayableItem } from '../types/player';

// ============================================================================
// CONTEXT
// ============================================================================

const PlayerContext = createContext<PlayerContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface PlayerProviderProps {
    children: ReactNode;
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children }) => {
    const {
        currentlyPlaying,
        isTransitioningToPlayer,
        currentSeries,
        playbackError,
        retryAttempt,
        play,
        stop,
        switchChannel,
        setCurrentSeries,
        retryPlayback,
        dismissPlaybackError,
        confirmPlaybackRecovered,
        cancelFailedLaunch,
    } = usePlaybackSession();
    const mpvConnected = useMpvConnection();
    usePlayerPageEffects(currentlyPlaying, isTransitioningToPlayer);
    const { playNextEpisode, playPreviousEpisode } = useEpisodeSkip(currentSeries, currentlyPlaying, play);

    const value: PlayerContextValue = useMemo(() => ({
        // State
        currentlyPlaying,
        mpvConnected,
        isTransitioningToPlayer,
        currentSeries,
        playbackError,
        retryAttempt,
        // Actions
        play,
        stop,
        switchChannel,
        playNextEpisode,
        playPreviousEpisode,
        setCurrentSeries,
        retryPlayback,
        dismissPlaybackError,
        confirmPlaybackRecovered,
        cancelFailedLaunch,
    }), [
        currentlyPlaying, mpvConnected, isTransitioningToPlayer, currentSeries, playbackError, retryAttempt,
        play, stop, switchChannel, playNextEpisode, playPreviousEpisode, retryPlayback, dismissPlaybackError,
        confirmPlaybackRecovered, cancelFailedLaunch, setCurrentSeries,
    ]);

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook pour accéder au contexte Player.
 * @throws Error si utilisé hors du PlayerProvider
 */
export function usePlayer(): PlayerContextValue {
    const context = useContext(PlayerContext);
    if (!context) {
        throw new Error('usePlayer must be used within a PlayerProvider');
    }
    return context;
}
