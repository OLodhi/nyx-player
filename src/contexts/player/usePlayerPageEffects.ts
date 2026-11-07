import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { setPlaybackBusy } from '../../services/playbackActivity';
import type { PlayableItem } from '../../types/player';
import { createLogger } from '../../utils/logger';
import { isIos } from '../../utils/platform';
import { enterPlayerViewport, exitPlayerViewport } from '../../utils/iosPlayerViewport';

const log = createLogger('PlayerContext');

/**
 * Effets d'une lecture sur le reste de l'application : travaux de fond suspendus, classe
 * player-active sur la page et fond de la fenêtre WebView2 (transparent pendant la lecture). Sur iPhone,
 * la page passe aussi en plein écran, encoche comprise (iosPlayerViewport).
 */
export function usePlayerPageEffects(currentlyPlaying: PlayableItem | null, isTransitioningToPlayer: boolean): void {
    // Travaux de fond (actualisation du catalogue) : jamais pendant une lecture ni son démarrage
    useEffect(() => {
        setPlaybackBusy(!!currentlyPlaying || isTransitioningToPlayer);
    }, [currentlyPlaying, isTransitioningToPlayer]);

    // Appliquer/retirer la classe player-active sur html/body
    // + toggler le DefaultBackgroundColor WebView2 (opaque ↔ transparent)
    useEffect(() => {
        if (currentlyPlaying) {
            document.documentElement.classList.add('player-active');
            document.body.classList.add('player-active');
            if (isIos()) enterPlayerViewport();
            invoke('set_webview_transparent').catch(e =>
                log.warn('set_webview_transparent failed:', e)
            );
        } else {
            document.documentElement.classList.remove('player-active');
            document.body.classList.remove('player-active');
            if (isIos()) exitPlayerViewport();
            invoke('set_webview_opaque').catch(e =>
                log.warn('set_webview_opaque failed:', e)
            );
        }
    }, [currentlyPlaying]);
}
